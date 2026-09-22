import type { ChatMessage, ToolGroupItem } from '@/shared/types';
import { getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';

export const TOOL_GROUP_THRESHOLD = 2;

/** How many of a group's tool inputs the collapsed summary line spells out. */
const PREVIEWED_TOOL_COUNT = 2;

// Interactive and stateful surfaces must stay visible instead of being hidden
// inside a routine activity group. Include both legacy and canonical names.
const NON_GROUPABLE_TOOL_NAMES = new Set([
  'AskUserQuestion',
  'TodoList',
  'TodoWrite',
  'TodoRead',
  'Task',
  'Workflow',
  'exit_plan_mode',
  'ExitPlanMode',
]);

const TOOL_CATEGORY_LABELS: Record<string, string> = {
  edit: 'Edit',
  search: 'Search',
  bash: 'Bash',
  todo: 'Todo',
  task: 'Task',
  agent: 'Agent',
  plan: 'Plan',
  question: 'Question',
  default: 'Other',
};


export type MessageListItem = ChatMessage | ToolGroupItem;

export function isToolGroupItem(item: MessageListItem): item is ToolGroupItem {
  return '_isGroup' in item && (item as ToolGroupItem)._isGroup === true;
}

// An agent's or a workflow's row is its whole card — status, timeline, result —
// so it never folds into a collapsed run with its neighbours.
function isGroupableToolMessage(message: ChatMessage): message is ChatMessage & { toolName: string } {
  return Boolean(
    message.isToolUse
    && message.toolName
    && !message.isSubagentContainer
    && !NON_GROUPABLE_TOOL_NAMES.has(message.toolName),
  );
}

// Messages that render nothing (e.g. reasoning hidden when showThinking is off)
// shouldn't split an otherwise-continuous run of the same tool — providers like
// Codex interleave hidden reasoning between consecutive tool calls.
function rendersNothing(message: ChatMessage, showThinking: boolean): boolean {
  return Boolean(message.isThinking && !showThinking);
}

function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }

  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

function getToolInputPreview(message: ChatMessage): string {
  const config = getToolConfig(message.toolName || 'UnknownTool').input;
  const parsedInput = parseToolInput(message.toolInput);
  const title = typeof config.title === 'function' ? config.title(parsedInput) : config.title;
  const value = config.getValue?.(parsedInput);

  return String(value || title || message.displayText || message.content || '').trim();
}

/** Returns the chat module's one canonical visual category for a tool. */
export function getToolCategory(toolName: string): string {
  if (['Edit', 'Write', 'ApplyPatch'].includes(toolName)) return 'edit';
  if (['Grep', 'Glob'].includes(toolName)) return 'search';
  if (toolName === 'Bash') return 'bash';
  if (['TodoWrite', 'TodoRead'].includes(toolName)) return 'todo';
  if (['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'].includes(toolName)) return 'task';
  if (toolName === 'Task') return 'agent';
  if (toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode') return 'plan';
  if (toolName === 'AskUserQuestion') return 'question';
  return 'default';
}

/** Builds the collapsed group's failure, running, or category summary. */
export function summarizeToolGroupActivity(messages: ChatMessage[]): string {
  const issue = messages.find((message) => message.toolResult?.isError
    || ['error', 'denied', 'stopped'].includes(String(message.toolStatus || '')));
  if (issue) {
    const issueLabel = issue.toolStatus === 'denied'
      ? 'Denied'
      : issue.toolStatus === 'stopped'
        ? 'Stopped'
        : 'Failed';
    return `${issueLabel}: ${issue.toolName || 'Tool'}`;
  }

  const running = [...messages].reverse().find((message) => message.toolStatus === 'running'
    || (!message.toolResult && !['completed', 'error', 'denied', 'stopped'].includes(String(message.toolStatus || ''))));
  if (running) {
    return `Running: ${getToolInputPreview(running) || running.toolName || 'Tool'}`;
  }

  const counts = new Map<string, number>();
  for (const message of messages) {
    const category = getToolCategory(message.toolName || 'UnknownTool');
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => `${TOOL_CATEGORY_LABELS[category] || 'Other'} ${count}`)
    .join(' · ');
}

/**
 * Builds the collapsed group's summary line.
 *
 * Computed here rather than in the component so it happens once per grouping
 * pass instead of once per group render. It is not cached beyond that: grouping
 * re-runs on every visible-session stream publish because visibleMessages is
 * a fresh array, and a run's preview changes as the run grows, so a cache would have to be
 * keyed on the whole run. The old 10Hz path measured 0.18ms per publish over a
 * 100-message window; the frame-aligned path is judged by per-second cost so a
 * higher publish rate cannot hide behind a cheap single call.
 */
function buildGroupPreview(messages: ChatMessage[]): string {
  const named = messages
    .slice(0, PREVIEWED_TOOL_COUNT)
    .map(getToolInputPreview)
    .filter(Boolean);

  const previewText = named.join(', ');
  // Subtracted from the previews actually printed, not from the two slots the
  // line reserves, so that named + extraCount === messages.length for every
  // input. A tool whose input yields no text — a Read with no file_path, an
  // input still arriving as partial JSON — is genuinely not named, so it
  // belongs in the remainder. Counting slots instead makes a group of three
  // whose first preview is empty render "/b.ts, +1 more" beside an x3 badge.
  const extraCount = messages.length - named.length;

  if (!previewText) {
    return extraCount > 0 ? `+${extraCount} more` : '';
  }

  return extraCount > 0 ? `${previewText}, +${extraCount} more` : previewText;
}

export function groupConsecutiveTools(
  messages: ChatMessage[],
  showThinking: boolean = true,
): MessageListItem[] {
  const items: MessageListItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];

    if (!isGroupableToolMessage(message)) {
      items.push(message);
      index += 1;
      continue;
    }

    const run: ChatMessage[] = [message];
    let nextIndex = index + 1;

    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];

      // Skip invisible interleaved messages so they don't break the run.
      if (rendersNothing(candidate, showThinking)) {
        nextIndex += 1;
        continue;
      }

      if (isGroupableToolMessage(candidate)) {
        run.push(candidate);
        nextIndex += 1;
        continue;
      }

      break;
    }

    // A one-tool run deliberately uses the same container and key shape as a
    // later multi-tool group. Otherwise arrival of tool two moves tool one to
    // a different React subtree, losing its DOM identity, expanded output and
    // measured height in one large layout jump.
    items.push({
      _isGroup: true,
      toolName: message.toolName,
      messages: run,
      timestamp: message.timestamp,
      preview: buildGroupPreview(run),
      activitySummary: summarizeToolGroupActivity(run),
    });

    index = nextIndex;
  }

  return items;
}
