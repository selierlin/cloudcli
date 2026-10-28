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
