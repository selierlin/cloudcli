import type { LLMProvider, PermissionMode } from '@/shared/types';

/**
 * The permission modes each provider accepts, mirrored from the backend
 * capability matrix (`provider-capabilities.service.ts`).
 *
 * The matrix is authoritative and chat overlays it once it loads; this mirror
 * is what the UI shows before that (and when the request fails). It exists as
 * one shared list because settings' permission panel used to keep its own copy,
 * which is how it ended up offering workbuddy the two modes that provider
 * cannot finish a turn in.
 */
export const FALLBACK_PERMISSION_MODES: Record<LLMProvider, PermissionMode[]> = {
  claude: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
  cursor: ['default', 'bypassPermissions'],
  codex: ['default', 'acceptEdits', 'bypassPermissions'],
  opencode: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  // `default`/`acceptEdits`/`plan` wait for an approver that `-p` never has;
  // only the self-answering modes can finish a workbuddy turn.
  workbuddy: ['auto', 'bypassPermissions'],
  dsh: ['default', 'auto'],
  pi: ['default', 'readonly'],
  zcode: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  omp: ['default', 'readonly'],
  // `default` routes OpenClaw's ACP permission requests to the chat UI;
  // `auto` answers them with the bridge's allow-once option.
  openclaw: ['default', 'auto'],
};

/**
 * The modes that need their own name, because the shared name would describe a
 * different mechanism.
 *
 * Unifying names is only right when the thing behind the name is the same.
 * `bypassPermissions` is one thing everywhere, so it is called one thing
 * everywhere. `auto` is not: Claude's `auto` is a model classifier that can
 * still deny a call, WorkBuddy's approves inside the engine with its guardrails
 * intact, and DSH/OpenClaw's answers an ACP request with "allow once". Naming
 * all three "Auto" told the user they were the same switch.
 *
 * The same applies to `default` where it is not the harness default: ZCode's is
 * a read-only build mode, Pi's and OMP's run autonomously, DSH's and OpenClaw's
 * ask in chat.
 *
 * A provider may always override a *description* — that is how provider-specific
 * nuance is explained. Only a *title* is gated by this table.
 */
export const PROVIDER_SPECIFIC_MODE_NAMES = {
  claude: ['auto'],
  workbuddy: ['auto'],
  dsh: ['default', 'auto'],
  openclaw: ['default', 'auto'],
  pi: ['default'],
  omp: ['default'],
  zcode: ['default'],
} as const satisfies Partial<Record<LLMProvider, readonly PermissionMode[]>>;

/** Whether `provider`'s `mode` has semantics of its own, and so its own name. */
export const hasProviderSpecificModeName = (
  provider: LLMProvider | string | undefined,
  mode: PermissionMode | string,
): boolean => {
  if (!provider) return false;

  const declared = (PROVIDER_SPECIFIC_MODE_NAMES as Record<string, readonly string[]>)[provider];
  return declared?.includes(mode) ?? false;
};
