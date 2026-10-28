import type { LLMProvider } from '@/shared/types.js';

/**
 * Static, backend-owned description of what one provider integration supports.
 *
 * The frontend renders its composer UI (permission mode picker, image upload,
 * abort button, ...) purely from this shape, which is what keeps the frontend
 * free of per-provider conditionals. New provider features should be exposed
 * here instead of branching on the provider id in React components.
 */
type ProviderCapabilities = {
  provider: LLMProvider;
  /** Permission modes the provider runtime understands, in cycle order. */
  permissionModes: string[];
  defaultPermissionMode: string;
  /** Whether image attachments can be included in a chat.send. */
  supportsImages: boolean;
  /** Whether general file attachments can be included in a chat.send. */
  supportsFiles: boolean;
  /** Whether an in-flight run can be cancelled via chat.abort. */
  supportsAbort: boolean;
  /** Whether interactive tool permission prompts can reach the UI. */
  supportsPermissionRequests: boolean;
  /** Whether the token-usage endpoint has data for this provider. */
  supportsTokenUsage: boolean;
  /** Whether the provider runtime can accept model-level reasoning effort. */
  supportsEffort: boolean;
  /**
   * Reasoning-effort levels the runtime can pass on, weakest first, and so the
   * levels a custom model-library entry may declare. Empty exactly when
   * `supportsEffort` is false. Covers every level a predefined model declares
   * (a providers test enforces this) and, unlike the model catalog, does not
   * depend on which upstream providers this machine has connected.
   */
  effortLevels: string[];
  /**
   * Whether an already-sent message can be replaced, which requires the
   * provider to re-run a conversation truncated at a chosen point.
   */
  supportsMessageEditing: boolean;
  /**
   * Whether a session's transcript can be branched into an independent one.
   */
  supportsSessionForking: boolean;
};

/**
 * The capability matrix mirrors what each runtime actually implements today:
 * - permission modes match the option sets accepted by each CLI/SDK.
 * - only the Claude SDK integration surfaces interactive permission requests.
 * - Cursor has no token usage endpoint support (its store.db has no usage rows).
 */
const PROVIDER_CAPABILITIES: Record<LLMProvider, ProviderCapabilities> = {
  claude: {
    provider: 'claude',
    permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: true,
    supportsEffort: true,
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    // `resumeSessionAt` re-runs a conversation truncated at a message, and
    // `forkSession` copies a transcript prefix into a new session file.
    supportsMessageEditing: true,
    supportsSessionForking: true,
  },
  cursor: {
    provider: 'cursor',
    // The CLI exposes one permission switch, `--force` (always allow), and the
    // runtime maps `bypassPermissions` onto it. `acceptEdits` and `plan` have
    // no flag to ride, so offering them here would have shown the user a
    // picker whose other two options changed nothing.
    permissionModes: ['default', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
    effortLevels: [],
    supportsMessageEditing: false,
    supportsSessionForking: false,
  },
  codex: {
    provider: 'codex',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    // Not from the Codex SDK, which only starts and resumes threads: both ride
    // the same CLI's `app-server` protocol, whose `thread/fork` copies a
    // thread up to a chosen turn. Editing is that fork plus a new prompt,
    // which is how Codex's own IDE clients do it.
    supportsMessageEditing: true,
    supportsSessionForking: true,
  },
  opencode: {
    provider: 'opencode',
    // Mapped by the runtime onto OpenCode's controls: `--agent plan` (plan),
    // `--auto` (bypassPermissions) and the OPENCODE_PERMISSION env var
    // (acceptEdits). See resolveOpenCodePermissionOptions in the OpenCode runtime adapter.
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    // Passed on as OpenCode's `--variant`. `thinking` (MiniMax's on/off
    // variant, paired with `none`) is not a strength, so it sorts last.
    effortLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking'],
    supportsMessageEditing: false,
    // Forking rides OpenCode's own HTTP API, driven through a throwaway
    // `opencode serve`: it remaps message ids itself, so the copy is a native
    // session the CLI resumes like any other. See OpenCodeForkProvider.
    supportsSessionForking: true,
  },
  workbuddy: {
    provider: 'workbuddy',
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    // The embedded CodeBuddy engine shares the app's permission-mode
    // vocabulary, but `-p` has no interactive approver and this provider
    // surfaces no permission requests (`supportsPermissionRequests: false`).
    // Modes that wait for one (`default`, `acceptEdits`, `plan`) hang the turn
    // until the run timeout, so only the self-answering modes are offered:
    // `auto` approves in-process, `bypassPermissions` skips the checks.
    permissionModes: ['auto', 'bypassPermissions'],
    defaultPermissionMode: 'auto',
    // Images and files reach the engine as stream-json input blocks; token
    // usage is summarized from the `message.usage` blocks persisted on
    // assistant/function_call transcript rows.
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    supportsEffort: true,
    supportsMessageEditing: true,
    // Forking is materialised in WorkbuddyForkProvider: the engine cannot cut
    // at a row itself, so the provider copies the transcript prefix into a new
    // session file that the next `--resume` picks up.
    supportsSessionForking: true,
  },
  dsh: {
    provider: 'dsh',
    effortLevels: [],
    // `default` routes DSH's one-shot ACP permission requests to the chat UI;
    // `auto` answers them with the harness's allow-once option. DSH keeps its
    // own sandbox policy, so neither mode rewrites the harness configuration.
    permissionModes: ['default', 'auto'],
    defaultPermissionMode: 'default',
    // Attachments are not passed through the ACP bridge yet.
    supportsImages: false,
    supportsFiles: false,
    supportsAbort: true,
    supportsPermissionRequests: true,
    supportsTokenUsage: false,
    supportsEffort: false,
    supportsMessageEditing: false,
    supportsSessionForking: false,
  },
  pi: {
    provider: 'pi',
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    // Pi runs tools autonomously with no approval gate. Its only real safety
    // lever is the built-in tool allowlist, so the picker offers the honest
    // pair: default (autonomous) and read-only (`--tools read,grep,find,ls`).
    permissionModes: ['default', 'readonly'],
    defaultPermissionMode: 'default',
    // Attachments ride Pi's native `@file` positional arguments (real file
    // input, not path references), and usage is summarized from transcripts.
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    // Effort maps onto Pi's `--thinking` levels for reasoning-capable models.
    supportsEffort: true,
    // Pi has no resume-at-an-entry flag, but a session is a self-contained
    // JSONL file: editing copies the prefix before the replaced prompt into a
    // new file and moves the session onto it, the same materialisation forking
    // uses. See PiSessionsProvider.rewindSession.
    supportsMessageEditing: true,
    // Pi's native `--fork` copies a whole session only, so a message-level fork
    // is materialised by copying the transcript prefix into a new file under a
    // fresh id, which the next `--session` run picks up. See PiForkProvider.
    supportsSessionForking: true,
  },
  zcode: {
    provider: 'zcode',
    effortLevels: [],
    // ZCode's `--mode` accepts build|edit|plan|yolo, mapped 1:1 from the shared
    // permission vocabulary. Headless ZCode has no approval channel: `edit`
    // auto-approves file writes but denies shell commands, `build` denies both,
    // and `yolo` approves everything. The default is `acceptEdits` (edit) so the
    // common file-editing flow works without silently granting command
    // execution; runs that need Bash must opt into `bypassPermissions` (yolo).
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'acceptEdits',
    // Attachments (including images) ride repeated `--attach <path>` flags.
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    // Usage is read from the `tokens` block ZCode persists on assistant messages.
    supportsTokenUsage: true,
    // No reasoning-effort entry point in the headless CLI.
    supportsEffort: false,
    // No resume-at-a-row in the one-shot `--prompt` path.
    supportsMessageEditing: false,
    // The CLI's bundled `app-server` protocol has `session/fork`, which copies a
    // conversation up to a message. When the dropped turns carry their own
    // workspace checkpoints that copy also rewinds files to the fork point, so
    // forking is gated on a pre-check that refuses such a branch — see
    // ZcodeForkProvider.
    supportsSessionForking: true,
  },
  omp: {
    provider: 'omp',
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    // OMP runs tools autonomously with no approval gate, and rejects an unknown
    // name in `--tools` outright. Its only real safety lever is therefore the
    // built-in tool allowlist, so the picker offers the honest pair: default
    // (autonomous) and read-only (`--tools read,grep,glob`).
    permissionModes: ['default', 'readonly'],
    defaultPermissionMode: 'default',
    // Attachments ride OMP's native `@file` positional arguments (real file
    // input, not path references), and usage is summarized from transcripts,
    // whose assistant `usage` block shares Pi's shape.
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: true,
    // Effort maps onto OMP's `--thinking` levels, taken from the per-model
    // `thinking` array in `omp models --json`.
    supportsEffort: true,
    // OMP has no resume-at-an-entry flag, but a session is a self-contained
    // JSONL file: editing copies the prefix before the replaced prompt into a
    // new file and moves the session onto it, the same materialisation forking
    // uses. See OmpSessionsProvider.rewindSession.
    supportsMessageEditing: true,
    // OMP ships no `--fork`, but a session is a self-contained JSONL file the
    // CLI loads by id: the fork copies the transcript prefix into a new file
    // under a fresh id, which the next `--session` run picks up. See
    // OmpForkProvider.
    supportsSessionForking: true,
  },
  openclaw: {
    provider: 'openclaw',
    effortLevels: [],
    // `default` routes OpenClaw's ACP permission requests to the chat UI;
    // `auto` answers them with the bridge's allow-once option. OpenClaw keeps its
    // own approval policy, so neither mode rewrites the harness configuration.
    permissionModes: ['default', 'auto'],
    defaultPermissionMode: 'default',
    // Attachments are not passed through the ACP bridge yet.
    supportsImages: false,
    supportsFiles: false,
    supportsAbort: true,
    supportsPermissionRequests: true,
    // History carries an assistant `usage` block per turn, so the token counter
    // reads the newest one on the active path.
    supportsTokenUsage: true,
    supportsEffort: false,
    supportsMessageEditing: false,
    // Phase 3 evaluates OpenClaw's ACP `fork` method.
    supportsSessionForking: false,
  },
};

/**
 * Application service exposing the provider capability matrix. Used by the
 * Providers routes (the capabilities endpoints) and by the Providers model
 * service, which reads `effortLevels` to validate custom-model effort.
 */
export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return PROVIDER_CAPABILITIES[provider];
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return Object.values(PROVIDER_CAPABILITIES);
  },
};
