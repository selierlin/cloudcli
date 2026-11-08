/**
 * Tool-approval registry shared by the provider runtimes.
 *
 * A runtime that can pause mid-turn (an MCP server asking for input, a tool
 * asking permission) registers the question here, sends it to the chat
 * transport, and awaits the person's answer. The transport resolves it by
 * `requestId` over the websocket, and lists the unanswered ones so a tab that
 * reconnects after a refresh replays the same prompt.
 *
 * Each runtime owns one registry: request ids are unique, but the pending set
 * is per provider so one provider's reconnect never lists another's prompts.
 */

import type {
  AnyRecord,
  ElicitationAnswer,
  PendingToolApproval,
  ToolApprovalDecision,
} from './types.js';

/**
 * The tool name an MCP elicitation travels under.
 *
 * The chat client registers its form panel under this name, so every runtime
 * that can surface an elicitation must send it verbatim; the panel is
 * provider-agnostic and keys off the name alone.
 */
export const MCP_ELICITATION_TOOL_NAME = 'McpElicitation';

/**
 * How long a question may wait before it is abandoned.
 *
 * `0` waits indefinitely, which is what an interactive form needs: the provider
 * protocol keeps its own timeout, and inventing an earlier one would retract a
 * form the person is still filling in.
 */
export type ToolApprovalWaitOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called when the question is abandoned (timeout, abort, run death). */
  onCancel?: (reason: string) => void;
  /**
   * Lookup fields copied into the pending list: `_sessionId`, `_toolName`,
   * `_input`, `_context` and `_receivedAt`. The transport reads them to replay
   * an unanswered prompt after a reload.
   */
  metadata?: AnyRecord;
};

/**
 * The pending-question operations a runtime exposes to the chat transport.
 *
 * `listPending` and `resolve` are what `provider.runtime.permissions` publishes;
 * `cancelSession` is how a dying run retracts its own questions so the UI does
 * not keep a form that can never be answered.
 */
export type ToolApprovalRegistry = {
  wait(requestId: string, options?: ToolApprovalWaitOptions): Promise<ToolApprovalDecision>;
  resolve(requestId: string, decision: ToolApprovalDecision): void;
  listPending(sessionId: string): PendingToolApproval[];
  /** Abandons every pending question of one session, answering each as cancelled. */
  cancelSession(sessionId: string, reason?: string): void;
};

type PendingEntry = {
  resolve: (decision: ToolApprovalDecision) => void;
  onCancel?: (reason: string) => void;
  metadata: AnyRecord;
};

/**
 * Creates the approval registry for one provider runtime.
 *
 * `defaultTimeoutMs` applies when a caller passes no `timeoutMs`; pass `0` to
 * make every question wait indefinitely.
 */
export function createToolApprovalRegistry(defaultTimeoutMs: number): ToolApprovalRegistry {
  const pending = new Map<string, PendingEntry>();

  const wait = (
    requestId: string,
    options: ToolApprovalWaitOptions = {},
  ): Promise<ToolApprovalDecision> => {
    const { timeoutMs = defaultTimeoutMs, signal, onCancel, metadata = {} } = options;

    return new Promise<ToolApprovalDecision>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        pending.delete(requestId);
        if (timeout) {
          clearTimeout(timeout);
        }
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
      };

      const finalize = (decision: ToolApprovalDecision) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(decision);
      };

      const abortHandler = () => {
        onCancel?.('cancelled');
        finalize({ cancelled: true });
      };

      if (timeoutMs > 0) {
        timeout = setTimeout(() => {
          onCancel?.('timeout');
          finalize(null);
        }, timeoutMs);
      }

      if (signal) {
        if (signal.aborted) {
          onCancel?.('cancelled');
          finalize({ cancelled: true });
          return;
        }
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      pending.set(requestId, { resolve: finalize, onCancel, metadata });
    });
  };

  const resolve = (requestId: string, decision: ToolApprovalDecision): void => {
    const entry = pending.get(requestId);
    if (entry) {
      entry.resolve(decision);
    }
  };

  const listPending = (sessionId: string): PendingToolApproval[] => {
    const answered: PendingToolApproval[] = [];
    for (const [requestId, entry] of pending.entries()) {
      if (entry.metadata._sessionId === sessionId) {
        answered.push({
          requestId,
          toolName: typeof entry.metadata._toolName === 'string' ? entry.metadata._toolName : 'UnknownTool',
          input: entry.metadata._input,
          context: entry.metadata._context,
          sessionId,
          receivedAt: entry.metadata._receivedAt instanceof Date ? entry.metadata._receivedAt : new Date(),
        });
      }
    }
    return answered;
  };

  const cancelSession = (sessionId: string, reason = 'cancelled'): void => {
    // Snapshot first: finalize deletes from the map while iterating.
    for (const entry of Array.from(pending.values())) {
      if (entry.metadata._sessionId !== sessionId) {
        continue;
      }
      entry.onCancel?.(reason);
      entry.resolve({ cancelled: true });
    }
  };

  return { wait, resolve, listPending, cancelSession };
}

/**
 * Turns a person's answer into the MCP elicitation result both protocols accept.
 *
 * An unanswered request is `cancel`, never an invented `accept` or `decline`. A
 * URL-mode request is accepted without content: accepting is consent to open
 * the page, and the server learns the outcome from the page itself. Only flat
 * form values survive, because a form field is never an object.
 */
export function toElicitationAnswer(
  decision: ToolApprovalDecision,
  mode?: string,
): ElicitationAnswer {
  if (!decision || decision.cancelled) {
    return { action: 'cancel' };
  }
  if (!decision.allow) {
    return { action: 'decline' };
  }
  if (mode === 'url') {
    return { action: 'accept' };
  }

  const raw = (decision.updatedInput as AnyRecord | undefined)?.content;
  const content: Record<string, string | number | boolean | string[]> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as AnyRecord)) {
      const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
      const isStringList = Array.isArray(value) && value.every((item) => typeof item === 'string');
      if (isPrimitive || isStringList) {
        content[key] = value as string | number | boolean | string[];
      }
    }
  }
  return { action: 'accept', content };
}
