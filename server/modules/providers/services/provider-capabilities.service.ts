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
    // `resumeSessionAt` re-runs a conversation truncated at a message, and
    // `forkSession` copies a transcript prefix into a new session file.
    supportsMessageEditing: true,
    supportsSessionForking: true,
  },
  cursor: {
    provider: 'cursor',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
    supportsImages: true,
    supportsFiles: true,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
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
    supportsMessageEditing: false,
    supportsSessionForking: false,
  },
  workbuddy: {
    provider: 'workbuddy',
    // The embedded CodeBuddy engine shares the app's permission-mode
    // vocabulary (default/acceptEdits/bypassPermissions/plan), passed through
    // `--permission-mode` on every run.
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    defaultPermissionMode: 'default',
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
    // The DSH ACP bridge answers one-shot permission requests programmatically;
    // the gateway is not wired to the UI yet, so the runtime auto-declines and
    // the composer offers no permission modes beyond the harness's own config.
    permissionModes: ['default'],
    defaultPermissionMode: 'default',
    // Attachments are not passed through the ACP bridge yet.
    supportsImages: false,
    supportsFiles: false,
    supportsAbort: true,
    supportsPermissionRequests: false,
    supportsTokenUsage: false,
    supportsEffort: false,
    supportsMessageEditing: false,
    supportsSessionForking: false,
  },
  pi: {
    provider: 'pi',
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
    supportsMessageEditing: false,
    supportsSessionForking: true,
  },
  zcode: {
    provider: 'zcode',
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
    // No resume-at-a-row or transcript fork in the one-shot `--prompt` path.
    supportsMessageEditing: false,
    supportsSessionForking: false,
  },
};

/**
 * Application service exposing the provider capability matrix.
 */
export const providerCapabilitiesService = {
  getProviderCapabilities(provider: LLMProvider): ProviderCapabilities {
    return PROVIDER_CAPABILITIES[provider];
  },

  listAllProviderCapabilities(): ProviderCapabilities[] {
    return Object.values(PROVIDER_CAPABILITIES);
  },
};
