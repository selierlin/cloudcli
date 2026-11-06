import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, copyFile, lstat, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DSH_MANAGED_MCP_ENTRY_ID_PREFIX,
  invalidateDshComposedDocument,
  readDshComposedMcpServers,
  type DshComposedMcpServers,
} from '@/modules/providers/list/dsh/dsh-cordis.provider.js';
import { restartDshAcpServerIfIdle } from '@/modules/providers/list/dsh/dsh-runtime.provider.js';
import { getDshHome } from '@/modules/providers/list/dsh/dsh-models.provider.js';
import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, McpTransport, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

/**
 * Provider registry MCP adapter for DSH.
 *
 * The harness mounts MCP servers from its Cordis composition, so the only place
 * a write can land is the patch layer it composes: `$DSH_HOME/cordis.patch.yml`,
 * the machine-level user layer that outranks every profile's own patch and is
 * therefore the one file both the ACP profile CloudCLI boots and the `web`
 * profile the user runs by hand already read.
 *
 * This adapter owns a marked block inside that file, and it edits the entries
 * the user declared in the same file outside the block. Every byte it does not
 * have to touch is preserved: the block is rebuilt between its two marker lines,
 * while a user entry only has the lines under its `config:` key replaced — the
 * file is never parsed and re-serialized, because a YAML round trip would drop
 * their comments and could rewrite their `!!js` expressions.
 *
 * A name the harness mounts from a layer CloudCLI cannot reach (a bundle, or a
 * profile's own patch) is reported read-only: writing it again under the same
 * `serverName` makes the harness's MCP client throw and the entry silently
 * disappear.
 *
 * Writes are atomic, keep a symlink target (the file is stow-managed) and are
 * verified against a fresh profile dump, rolling back when the harness stops
 * composing what the write claimed to change.
 */

/** Harness transport declarations, mapped to the transport the settings list can display. */
const DSH_TRANSPORT_BY_DECLARATION: Record<string, McpTransport> = {
  stdio: 'stdio',
  'streamable-http': 'http',
};

/** Inverse of {@link DSH_TRANSPORT_BY_DECLARATION}: the declaration the harness config must carry. */
const DSH_DECLARATION_BY_TRANSPORT: Record<McpTransport, string> = {
  stdio: 'stdio',
  http: 'streamable-http',
  sse: 'sse',
};

/** Loader package that bridges an external MCP server into the harness tool list. */
const DSH_MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';

/** First line of the block CloudCLI owns inside the harness home patch layer. */
const MANAGED_BLOCK_BEGIN = '# >>> cloudcli:mcp begin (managed by CloudCLI, do not edit)';

/** Last line of the block CloudCLI owns inside the harness home patch layer. */
const MANAGED_BLOCK_END = '# <<< cloudcli:mcp end';

/**
 * Profiles that get the servers CloudCLI writes.
 *
 * The home layer applies to every profile, so the block gates itself: `web` is
 * the harness UI the user runs by hand and `acp` is what CloudCLI boots, while
 * one-off profiles (`headless`, `probe`) stay untouched. A whitelist is used
 * rather than a denylist so a profile added later does not inherit servers it
 * never asked for.
 */
const DSH_MCP_ENABLED_PROFILES = ['acp', 'web'];

/**
 * `!!js` expression the harness evaluates per profile.
 *
 * Quoted YAML scalars are used on both levels (single outside, double inside) so
 * the expression needs no escaping; the composer prints it back verbatim, and
 * the dump reader treats a non-`true` `disabled` value as enabled, which is why
 * the read path does not have to evaluate it.
 */
const MANAGED_ENTRY_GUARD = `!!js '!${JSON.stringify(DSH_MCP_ENABLED_PROFILES)}.includes(ctx.get("profileContext")?.name)'`;

/**
 * Prefix of the timestamped copies kept beside the patch layer before a write.
 *
 * One slot is not enough: the patch layer is hand-written (it carries the
 * user's own entries and comments) and two writes in a row would leave only the
 * intermediate state, not the file as it stood before CloudCLI touched it.
 */
const BACKUP_SUFFIX = '.cloudcli-';

/** How many backups survive a write; older ones are pruned oldest-first. */
const BACKUP_KEEP = 5;

const patchFilePath = (): string => path.join(getDshHome(), 'cordis.patch.yml');

/**
 * Copies the patch layer aside under a second-resolution timestamp, then prunes
 * everything past `BACKUP_KEEP`.
 *
 * Best effort: a failed backup must not block the write it was protecting, and
 * it must not fail twice — the caller only cares that the new content landed.
 */
const backupPatchLayer = async (filePath: string): Promise<void> => {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}${BACKUP_SUFFIX}`;
  // `:` and `.` in an ISO string are legal but awkward in a shell; dashes keep
  // the lexical sort order the pruning relies on and keep the name glob-safe.
  // Milliseconds, because two writes can land in the same second.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await copyFile(filePath, path.join(directory, `${prefix}${stamp}.bak`)).catch(() => undefined);

  const backups = (await readdir(directory).catch(() => [] as string[]))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
    .sort();
  for (const stale of backups.slice(0, Math.max(0, backups.length - BACKUP_KEEP))) {
    await rm(path.join(directory, stale), { force: true }).catch(() => undefined);
  }
};

const isMissingFile = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

/**
 * Renders one YAML scalar as a double-quoted string.
 *
 * JSON string syntax is a subset of YAML's double-quoted style, so this keeps
 * every value (URLs, header tokens, arguments with spaces) literal without a
 * YAML dependency, and it keeps the generated block stable across writes so the
 * managed-block diff only shows real changes.
 */
const yamlString = (value: string): string => JSON.stringify(value);

/**
 * Renders one MCP server's `config:` mapping at the given indentation.
 *
 * Shared by the managed block and the in-place rewrite of a user entry, so both
 * produce the same field order and the same quoting for the same definition.
 */
const renderConfigLines = (
  name: string,
  config: Record<string, unknown>,
  indent: number,
): string[] => {
  const pad = ' '.repeat(indent);
  const lines = [
    `${pad}serverName: ${yamlString(name)}`,
    `${pad}transport: ${yamlString(String(config.transport ?? ''))}`,
  ];

  for (const key of ['command', 'cwd', 'url'] as const) {
    const value = readOptionalString(config[key]);
    if (value) {
      lines.push(`${pad}${key}: ${yamlString(value)}`);
    }
  }

  const args = readStringArray(config.args);
  if (args?.length) {
    lines.push(`${pad}args:`);
    for (const arg of args) {
      lines.push(`${pad}  - ${yamlString(arg)}`);
    }
  }

  for (const key of ['env', 'headers'] as const) {
    const values = readStringRecord(config[key]);
    if (values && Object.keys(values).length > 0) {
      lines.push(`${pad}${key}:`);
      for (const [entryKey, entryValue] of Object.entries(values)) {
        lines.push(`${pad}  ${yamlString(entryKey)}: ${yamlString(entryValue)}`);
      }
    }
  }

  return lines;
};

/** Renders one MCP server as a loader patch entry inside the managed block. */
const renderManagedEntry = (name: string, config: Record<string, unknown>): string[] => {
  // The loader id only has to be stable and unique; the name prefix is what the
  // reader uses to tell CloudCLI rows apart from the user's own entries, and the
  // hash keeps names that slug identically (`a/b` and `a-b`) from colliding.
  const slug = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const digest = createHash('sha1').update(name).digest('hex').slice(0, 6);
  const id = `${DSH_MANAGED_MCP_ENTRY_ID_PREFIX}${slug || 'server'}-${digest}`;

  return [
    '- insert:',
    `    - id: ${id}`,
    `      name: '${DSH_MCP_CLIENT_PACKAGE}'`,
    `      disabled: ${MANAGED_ENTRY_GUARD}`,
    '      config:',
    ...renderConfigLines(name, config, 8),
  ];
};

/**
 * Renders the whole managed block for `servers`, or an empty string when there
 * is nothing to write.
 *
 * Entries are sorted by name so a write that only changes one server produces a
 * diff for that server instead of reshuffling the block.
 */
const renderDshManagedMcpBlock = (servers: Record<string, unknown>): string => {
  const names = Object.keys(servers).sort();
  if (names.length === 0) {
    return '';
  }

  const lines = [MANAGED_BLOCK_BEGIN];
  for (const name of names) {
    const config = readObjectRecord(servers[name]);
    if (!config) {
      continue;
    }
    lines.push(...renderManagedEntry(name, config));
  }
  lines.push(MANAGED_BLOCK_END);
  return `${lines.join('\n')}\n`;
}

/** Offsets of the managed block in `content`, or null when the file carries none. */
const findManagedBlock = (content: string): { start: number; end: number } | null => {
  const lines = content.split('\n');
  let start = -1;
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (start < 0) {
      if (trimmed === MANAGED_BLOCK_BEGIN) {
        start = offset;
      }
    } else if (trimmed === MANAGED_BLOCK_END) {
      // The end offset includes the marker's own newline so replacing the block
      // does not leave a blank line behind.
      return { start, end: offset + line.length + 1 };
    }
    offset += line.length + 1;
  }

  return null;
};

/**
 * Replaces (or appends) the managed block in one patch document.
 *
 * Only the bytes between the markers are rewritten. When `servers` is empty the
 * block is removed entirely, leaving the user's file exactly as it was before
 * CloudCLI first wrote to it.
 *
 * Exported for the DSH MCP test, which pins the byte-preservation rules.
 */
export function applyDshManagedMcpBlock(content: string, servers: Record<string, unknown>): string {
  const block = renderDshManagedMcpBlock(servers);
  const existing = findManagedBlock(content);

  if (existing) {
    const before = content.slice(0, existing.start);
    const after = content.slice(existing.end);
    if (block) {
      return `${before}${block}${after}`;
    }
    // Removing the block also removes the blank separator a previous append
    // added, so a create-then-delete cycle restores the original bytes.
    const trimmedBefore = before.endsWith('\n\n') ? before.slice(0, -1) : before;
    return `${trimmedBefore}${after}`;
  }

  if (!block) {
    return content;
  }

  const separator = content.length === 0 || content.endsWith('\n\n')
    ? ''
    : content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${separator}${block}`;
}

/** One MCP entry the user declared in the home patch layer, outside the managed block. */
type DshHomePatchEntry = {
  name: string;
  /** Index of the item's own `- id:` line, and of the first line after the item. */
  startLine: number;
  endLine: number;
  /** Column the item's keys start at, and the column of its `config:` key. */
  indent: number;
  configIndent: number;
  /** Byte offsets of the first line inside `config:` and of the line that ends it. */
  bodyStart: number;
  bodyEnd: number;
};

const ITEM_ID_PATTERN = /^(\s*)-\s+id:\s*\S/;
const CONFIG_KEY_PATTERN = /^(\s*)config:\s*$/;
const CONFIG_SERVER_NAME_PATTERN = /^(\s*)serverName:\s*(.+)$/;

const lineIndent = (line: string): number => line.length - line.trimStart().length;

/** Reads one YAML scalar as written; anything else is returned verbatim. */
const parsePatchScalar = (raw: string): string => {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }

  return value;
};

const lineOffsets = (lines: string[]): number[] => {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }

  return offsets;
};

/**
 * Lists the MCP entries one patch document declares outside CloudCLI's block.
 *
 * The scan is line-based on purpose: the file carries the user's comments and
 * `!!js` expressions, which a real parse would lose on the way back out. An item
 * is located by its `- id:` line and ends at the first line at its own indent or
 * shallower, so a comment directly above the next item stays with that item. An
 * item whose `config:` is flow-style, or whose `serverName` cannot be read, is
 * skipped: it is reported as unwritable rather than rewritten blindly.
 *
 * Exported for the DSH MCP test, which pins the byte-preservation rules.
 */
export function readDshHomePatchEntries(content: string): DshHomePatchEntry[] {
  const lines = content.split('\n');
  const offsets = lineOffsets(lines);
  const entries: DshHomePatchEntry[] = [];
  let inManagedBlock = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trimEnd() === MANAGED_BLOCK_BEGIN) {
      inManagedBlock = true;
      continue;
    }
    if (line.trimEnd() === MANAGED_BLOCK_END) {
      inManagedBlock = false;
      continue;
    }
    if (inManagedBlock) {
      continue;
    }

    const item = ITEM_ID_PATTERN.exec(line);
    if (!item) {
      continue;
    }
    const indent = item[1].length;

    let endLine = lines.length;
    for (let next = index + 1; next < lines.length; next++) {
      if (lines[next].trim() !== '' && lineIndent(lines[next]) <= indent) {
        endLine = next;
        break;
      }
    }

    let configLine = -1;
    for (let next = index + 1; next < endLine; next++) {
      const key = CONFIG_KEY_PATTERN.exec(lines[next]);
      if (key && key[1].length > indent) {
        configLine = next;
        break;
      }
    }
    if (configLine < 0) {
      continue;
    }
    const configIndent = CONFIG_KEY_PATTERN.exec(lines[configLine])?.[1].length ?? 0;

    let bodyEndLine = endLine;
    for (let next = configLine + 1; next < endLine; next++) {
      if (lines[next].trim() !== '' && lineIndent(lines[next]) <= configIndent) {
        bodyEndLine = next;
        break;
      }
    }

    let name = '';
    for (let next = configLine + 1; next < bodyEndLine; next++) {
      const match = CONFIG_SERVER_NAME_PATTERN.exec(lines[next]);
      if (match && match[1].length > configIndent) {
        name = parsePatchScalar(match[2]);
        break;
      }
    }
    if (!name) {
      continue;
    }

    entries.push({
      name,
      startLine: index,
      endLine,
      indent,
      configIndent,
      bodyStart: offsets[configLine] + lines[configLine].length + 1,
      bodyEnd: bodyEndLine < lines.length ? offsets[bodyEndLine] : content.length,
    });
  }

  return entries;
}

/** The entry one patch document declares for `name`, or null when it declares none. */
const findDshHomePatchEntry = (content: string, name: string): DshHomePatchEntry | null =>
  readDshHomePatchEntries(content).find((entry) => entry.name === name) ?? null;

/**
 * Replaces the `config:` mapping of one user entry, leaving every other byte of
 * the item (its id, its loader name, any guard expression, its comments) as it
 * was. Returns null when the document no longer declares that server.
 */
export const applyDshHomePatchEntryConfig = (
  content: string,
  name: string,
  config: Record<string, unknown>,
): string | null => {
  const entry = findDshHomePatchEntry(content, name);
  if (!entry) {
    return null;
  }

  const body = `${renderConfigLines(name, config, entry.configIndent + 2).join('\n')}\n`;
  return `${content.slice(0, entry.bodyStart)}${body}${content.slice(entry.bodyEnd)}`;
};

/**
 * Removes one user entry, together with the comment lines directly above it
 * that describe it. Returns null when the document no longer declares it.
 */
export const applyDshHomePatchEntryRemoval = (content: string, name: string): string | null => {
  const entry = findDshHomePatchEntry(content, name);
  if (!entry) {
    return null;
  }

  const lines = content.split('\n');
  let startLine = entry.startLine;
  while (
    startLine > 0
    && lines[startLine - 1].trimStart().startsWith('#')
    && lineIndent(lines[startLine - 1]) === entry.indent
  ) {
    startLine--;
  }

  const offsets = lineOffsets(lines);
  const start = offsets[startLine];
  const end = entry.endLine < lines.length ? offsets[entry.endLine] : content.length;
  return `${content.slice(0, start)}${content.slice(end)}`;
};

/**
 * Resolves the file a write must actually touch.
 *
 * The patch layer is stow-managed on some machines, so it is a symlink into a
 * dotfiles checkout. Renaming over the link itself would replace it with a
 * regular file and silently detach the checkout, so the caller writes to the
 * link's target and leaves the link in place.
 */
const resolveWriteTarget = async (filePath: string): Promise<string> => {
  const stats = await lstat(filePath).catch(() => null);
  return stats?.isSymbolicLink() ? realpath(filePath) : filePath;
};

/**
 * Keys whose values are credentials rather than configuration. Scanned across
 * the whole document, not just the managed block: a user-authored MCP entry
 * carries the same bearer token in its own `headers`, and the cap only ever
 * narrows, so a false positive costs nothing.
 */
const CREDENTIAL_KEYS = /^\s*"?(?:headers|authorization)"?\s*:/im;

/**
 * Upper bound for the mode of a document carrying credentials.
 *
 * Returns the unchanged cap when the document has none, so the caller can `&`
 * it unconditionally. Only narrows: a file already at 0600 (or stricter) keeps
 * its own mode, and a file without credentials keeps the mode it had.
 */
const credentialModeCap = (content: string): number =>
  CREDENTIAL_KEYS.test(content) ? 0o600 : 0o7777;

/**
 * Atomically replaces `filePath`, keeping its symlink and its permissions —
 * except that a document carrying credentials never inherits the group/other
 * bits of the file it replaces.
 */
const writeFileAtomicThroughLinks = async (filePath: string, content: string): Promise<void> => {
  const target = await resolveWriteTarget(filePath);
  // A rename installs a new inode, so the temp file has to carry the original
  // mode explicitly: the default (`0o600`) would silently narrow a dotfiles
  // checkout from 0644 and make the file unreadable for anything but its owner.
  // `writeFile`'s mode is masked by the umask, so the exact mode is restored
  // after creation rather than passed in.
  const existing = await stat(target).catch(() => null);
  // `stat().mode` also carries the file type bits; only the permission bits are
  // meaningful to `chmod`, and passing the rest through is not portable.
  const mode = (existing ? existing.mode & 0o7777 : 0o600) & credentialModeCap(content);
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, content, { encoding: 'utf8', mode, flag: 'wx' });
    if (existing) {
      await chmod(temp, mode);
    }
    await rename(temp, target);
    // The cached composition describes the file as it was before this write;
    // keeping it would make the verification pass compare against stale output.
    invalidateDshComposedDocument();
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

/** The home patch layer as it is on disk, or null when the user has no such file. */
const readPatchLayer = (): string | null => {
  try {
    return readFileSync(patchFilePath(), 'utf8');
  } catch {
    return null;
  }
};

/** The `serverName` values the home patch layer declares outside CloudCLI's block. */
const readHomePatchServerNames = (): Set<string> =>
  new Set(readDshHomePatchEntries(readPatchLayer() ?? '').map((entry) => entry.name));

/** True when the composed config carries every field the write set. */
const composedConfigMatches = (actual: unknown, expected: Record<string, unknown>): boolean => {
  const config = readObjectRecord(actual);
  if (!config) {
    return false;
  }

  return (['transport', 'url', 'command'] as const).every(
    (key) => expected[key] === undefined || config[key] === expected[key],
  );
};

/**
 * Reads the composed tree, refusing to continue when the dump did not run.
 *
 * A failed dump reports both server sets as empty, so a writer that trusts it
 * would treat "the CLI is unavailable" as "the user has no servers" and rebuild
 * the managed block from that empty picture — silently deleting every entry
 * CloudCLI put there. Failing the request is the only safe outcome: the user
 * keeps their configuration and can retry once `dsh` works again.
 */
const requireDshComposedMcpServers = (): DshComposedMcpServers => {
  const composed = readDshComposedMcpServers();
  if (!composed.ok) {
    throw new AppError(
      'DSH configuration could not be read (`dsh --dump-config` failed); rewriting the MCP block now would drop existing servers.',
      { code: 'DSH_MCP_UNREADABLE', statusCode: 409 },
    );
  }
  return composed;
};

/**
 * Rejects a managed-block rewrite that drops an entry the caller did not name.
 *
 * The block is rebuilt as a whole, so one missing key is enough to lose a
 * server. Every caller derives its map from the baseline it just read, which
 * means a dropped key can only come from a bug in that derivation (or from a
 * stale baseline); failing before the write turns a silent data loss into an
 * error the user can report.
 */
const assertManagedKeysPreserved = (
  baseline: DshComposedMcpServers,
  servers: Record<string, unknown>,
  allowedRemoval?: string,
): void => {
  const dropped = Object.keys(baseline.managed).filter(
    (name) => name !== allowedRemoval && !Object.prototype.hasOwnProperty.call(servers, name),
  );
  if (dropped.length > 0) {
    throw new AppError(
      `Refusing to drop ${dropped.join(', ')} from the DSH MCP block; only the requested server may be removed.`,
      { code: 'DSH_MCP_ENTRIES_DROPPED', statusCode: 500 },
    );
  }
};

/**
 * Applies one transformation to the home patch layer, verifies the harness still
 * composes what the caller expected, and rolls the file back when it does not.
 *
 * The baseline is passed in rather than read here so the gate, the backup and
 * the verification all describe the same snapshot: a second dump between them
 * could succeed for the gate and fail for the write, which is exactly the case
 * that used to skip verification and keep a bad file.
 *
 * The verification dump is the only way to catch a mistake the writer itself
 * cannot see (a value the loader rejects, a duplicate name, a broken document).
 */
const writePatchLayer = async (
  baseline: DshComposedMcpServers,
  transform: (content: string) => string | null,
  isApplied: (composed: DshComposedMcpServers) => boolean,
  failureMessage: string,
): Promise<void> => {
  if (!baseline.ok) {
    throw new AppError(
      'DSH configuration could not be read (`dsh --dump-config` failed); the MCP block was not rewritten.',
      { code: 'DSH_MCP_UNREADABLE', statusCode: 409 },
    );
  }

  const filePath = patchFilePath();
  const previousContent = await readFile(filePath, 'utf8').catch((error: unknown) => {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  });

  const nextContent = transform(previousContent ?? '');
  if (nextContent === null || nextContent === (previousContent ?? '')) {
    restartDshAcpServerIfIdle();
    return;
  }

  if (previousContent !== null) {
    await backupPatchLayer(filePath);
  }

  await writeFileAtomicThroughLinks(filePath, nextContent);

  const after = readDshComposedMcpServers();
  if (after.ok && isApplied(after)) {
    restartDshAcpServerIfIdle();
    return;
  }

  if (previousContent === null) {
    await rm(filePath, { force: true });
    invalidateDshComposedDocument();
  } else {
    await writeFileAtomicThroughLinks(filePath, previousContent);
  }

  throw new AppError(failureMessage, {
    code: 'DSH_MCP_WRITE_NOT_APPLIED',
    statusCode: 502,
  });
};

/** Rewrites the managed block, failing the write when a server stops mounting. */
const writeManagedServers = (
  servers: Record<string, unknown>,
  baseline: DshComposedMcpServers,
  allowedRemoval?: string,
): Promise<void> => {
  assertManagedKeysPreserved(baseline, servers, allowedRemoval);
  return writePatchLayer(
    baseline,
    (content) => applyDshManagedMcpBlock(content, servers),
    (composed) => Object.keys(servers).every(
      (name) => Object.prototype.hasOwnProperty.call(composed.managed, name),
    ),
    `DSH did not mount ${Object.keys(servers).join(', ')} after the write; the patch layer was rolled back.`,
  );
};

export class DshMcpProvider extends McpProvider {
  constructor() {
    super('dsh', ['user'], ['stdio', 'http']);
  }

  /**
   * Reports no scope to the catalog seeder even though writes are accepted.
   *
   * The seeder harvests whatever `listRawServersForScope('user')` returns, and
   * for DSH that includes the servers the user wrote into the same patch layer
   * themselves. Seeding one would copy a definition they maintain by hand into a
   * catalog row, and every later resync would then rewrite their entry into
   * CloudCLI's canonical form — their comments and formatting gone. Every server
   * the catalog really owns was projected by it and is already a catalog row.
   */
  listWritableScopes(): McpScope[] {
    return [];
  }

  protected async readScopedServers(scope: McpScope, _workspacePath: string): Promise<Record<string, unknown>> {
    // DSH has no per-project MCP scope: its servers come from the harness home
    // and the booted profile, so they are reported under `user` only. Returning
    // them for `project` as well would list the same server once per project.
    return scope === 'user' ? readDshComposedMcpServers().all : {};
  }

  /**
   * Marks where each row's definition lives.
   *
   * Both kinds of row are listed — the user asked to see what the harness
   * mounts — but only the ones CloudCLI can rewrite are editable, and the
   * settings list needs to know which is which.
   */
  async listRawServersForScope(
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    const servers = await super.listRawServersForScope(scope, options);
    if (scope !== 'user' || servers.length === 0) {
      return servers;
    }

    const { managed } = readDshComposedMcpServers();
    const homePatch = readHomePatchServerNames();
    return servers.map((server) => ({
      ...server,
      origin: Object.prototype.hasOwnProperty.call(managed, server.name)
        ? 'app'
        : homePatch.has(server.name) ? 'homePatch' : 'harness',
    }));
  }

  /**
   * Every server the harness mounts from a layer CloudCLI cannot rewrite.
   *
   * The user's own entries in the home patch layer are excluded: that file is
   * written by this adapter, so those rows are editable rather than external.
   */
  listExternallyManagedNames(): string[] {
    const { all, managed } = readDshComposedMcpServers();
    const homePatch = readHomePatchServerNames();
    return Object.keys(all).filter(
      (name) => !Object.prototype.hasOwnProperty.call(managed, name) && !homePatch.has(name),
    );
  }

  /**
   * Rewrites the managed block from the map the base class read back.
   *
   * The map is every composed server, so the harness's own rows have to be
   * filtered out: a name it already mounts from another layer would collide and
   * the entry would stop loading. A name that is neither in the block nor
   * mounted anywhere is a new server, which belongs in the block.
   */
  protected async writeScopedServers(
    scope: McpScope,
    _workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    this.assertScope(scope);
    const composed = requireDshComposedMcpServers();
    const { all, managed } = composed;
    const next: Record<string, unknown> = {};
    for (const [name, config] of Object.entries(servers)) {
      if (Object.prototype.hasOwnProperty.call(managed, name)
        || !Object.prototype.hasOwnProperty.call(all, name)) {
        next[name] = config;
      }
    }

    await writeManagedServers(next, composed);
  }

  /**
   * Adds or replaces one server.
   *
   * Overridden rather than inherited because the inherited version reads every
   * composed server and writes the map back, which would copy the harness's own
   * entries into the managed block and collide with them.
   *
   * A name the user declared in the home patch layer is rewritten in place: only
   * its `config:` mapping is replaced, so the definition stays where they wrote
   * it and their comments and loader options survive. A new name goes into
   * CloudCLI's block, and one that only a bundle or profile patch declares is
   * refused — writing it would make the MCP client throw and drop the entry.
   */
  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    const scope = input.scope ?? 'user';
    this.assertScopeAndTransport(scope, input.transport);

    const name = input.name.trim();
    if (!name) {
      throw new AppError('MCP server name is required.', {
        code: 'MCP_SERVER_NAME_REQUIRED',
        statusCode: 400,
      });
    }

    const composed = requireDshComposedMcpServers();
    const persisted = this.normalizeServerConfig(scope, name, composed.all[name]);
    const restored: UpsertProviderMcpServerInput = {
      ...input,
      env: restoreSecrets(input.env, persisted?.env),
      headers: restoreSecrets(input.headers, persisted?.headers),
    };
    const config = this.buildServerConfig(restored);

    if (Object.prototype.hasOwnProperty.call(composed.managed, name)) {
      await writeManagedServers({ ...composed.managed, [name]: config }, composed);
    } else if (readHomePatchServerNames().has(name)) {
      await writePatchLayer(
        composed,
        (content) => applyDshHomePatchEntryConfig(content, name, config),
        (after) => composedConfigMatches(after.all[name], config),
        `DSH did not apply the new definition of "${name}"; the patch layer was rolled back.`,
      );
    } else if (Object.prototype.hasOwnProperty.call(composed.all, name)) {
      throw externallyManagedError(name);
    } else {
      await writeManagedServers({ ...composed.managed, [name]: config }, composed);
    }

    return this.sanitizeServerForResponse({
      provider: 'dsh',
      name,
      scope,
      transport: input.transport,
      command: restored.command,
      args: restored.args,
      env: restored.env,
      cwd: restored.cwd,
      url: restored.url,
      headers: restored.headers,
    });
  }

  /**
   * Removes one server from wherever its definition lives.
   *
   * A CloudCLI-owned entry leaves the managed block; one the user declared
   * themselves is deleted from their patch layer. A name only another layer
   * supplies reports `removed: false` rather than an error: there is nothing
   * here to delete, and failing would block the catalog from clearing its own
   * switch (and from deleting the row) for an entry the harness mounts itself.
   */
  async removeServer(input: {
    name: string;
    scope?: McpScope;
    workspacePath?: string;
  }): Promise<{ removed: boolean; provider: 'dsh'; name: string; scope: McpScope }> {
    const scope = input.scope ?? 'user';
    this.assertScope(scope);

    const name = input.name.trim();
    const composed = requireDshComposedMcpServers();

    if (Object.prototype.hasOwnProperty.call(composed.managed, name)) {
      const next = { ...composed.managed };
      delete next[name];
      await writeManagedServers(next, composed, name);
      return { removed: true, provider: 'dsh', name, scope };
    }

    if (readHomePatchServerNames().has(name)) {
      await writePatchLayer(
        composed,
        (content) => applyDshHomePatchEntryRemoval(content, name),
        () => true,
        `DSH still loads "${name}" after removing it; the patch layer was rolled back.`,
      );
      return { removed: true, provider: 'dsh', name, scope };
    }

    return { removed: false, provider: 'dsh', name, scope };
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    return {
      serverName: input.name,
      transport: DSH_DECLARATION_BY_TRANSPORT[input.transport],
      ...(input.command ? { command: input.command } : {}),
      ...(input.args?.length ? { args: input.args } : {}),
      ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.url ? { url: input.url } : {}),
      ...(input.headers && Object.keys(input.headers).length > 0 ? { headers: input.headers } : {}),
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) {
      return null;
    }

    const declaredTransport = readOptionalString(config.transport);
    const transport = declaredTransport ? DSH_TRANSPORT_BY_DECLARATION[declaredTransport] : undefined;
    if (!transport) {
      return null;
    }

    return {
      provider: 'dsh',
      name,
      scope,
      transport,
      command: readOptionalString(config.command),
      args: readStringArray(config.args),
      env: readStringRecord(config.env),
      cwd: readOptionalString(config.cwd),
      url: readOptionalString(config.url),
      headers: readStringRecord(config.headers),
    };
  }
}

/** One name the harness already mounts from a layer CloudCLI does not own. */
const externallyManagedError = (name: string): AppError => new AppError(
  `"${name}" is supplied by the DeepSeek Harness's own configuration; edit it there instead.`,
  { code: 'DSH_MCP_EXTERNALLY_MANAGED', statusCode: 409 },
);

/** Re-applies the form's `<redacted>` markers against the persisted secrets. */
const restoreSecrets = (
  requested?: Record<string, string>,
  persisted?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!requested || !persisted) {
    return requested;
  }

  return Object.fromEntries(Object.entries(requested).map(([key, value]) => [
    key,
    value === '<redacted>' && Object.prototype.hasOwnProperty.call(persisted, key)
      ? persisted[key]
      : value,
  ]));
};
