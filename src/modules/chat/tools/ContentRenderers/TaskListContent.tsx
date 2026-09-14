import React from 'react';

type TaskItem = {
  id: string;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
  blockedBy?: string[];
};

type TaskListContentProps = {
  content: string;
};

type TaskSegment =
  | { kind: 'tasks'; items: TaskItem[] }
  | { kind: 'text'; lines: string[] };

/**
 * A task line, anchored to the start of the line so a prose reference such as
 * "Note: #99 is tracked elsewhere" is not read as a task. The optional `- `
 * prefix and leading whitespace are required: the list-prefix form below is a
 * documented shape, and a bare `^#(\d+)` would drop those rows.
 */
const TASK_LINE = /^\s*(?:-\s*)?#(\d+)\.?\s*(?:\[(\w+)\]\s*)?(.+?)(?:\s*\((?:owner:\s*\w+)?\))?$/;

function parseTaskLine(line: string): TaskItem | null {
  // Match patterns like: #15. [in_progress] Subject here
  // or: - #15 [in_progress] Subject (owner: agent)
  // or: #15. Subject here (status: in_progress)
  const match = line.match(TASK_LINE);
  if (!match) return null;

  const [, id, status, subject] = match;
  const blockedMatch = line.match(/blockedBy:\s*\[([^\]]*)\]/);
  return {
    id,
    subject: subject.trim(),
    status: (status as TaskItem['status']) || 'pending',
    blockedBy: blockedMatch ? blockedMatch[1].split(',').map(s => s.trim()).filter(Boolean) : undefined
  };
}

/**
 * Splits the payload into ordered segments so no line is dropped: runs of
 * parseable task lines become `tasks` segments, everything else becomes a
 * `text` segment rendered as source. A previous line-by-line filter kept only
 * the lines it understood, silently discarding headers, notes and separators.
 */
function parseTaskContent(content: string): TaskSegment[] {
  const segments: TaskSegment[] = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    // Blank lines at the edges of a run carry no content (a trailing newline,
    // or the gap between two task groups); interior blanks are preserved.
    let start = 0;
    let end = textBuffer.length;
    while (start < end && textBuffer[start].trim() === '') start++;
    while (end > start && textBuffer[end - 1].trim() === '') end--;
    if (end > start) {
      segments.push({ kind: 'text', lines: textBuffer.slice(start, end) });
    }
    textBuffer = [];
  };

  for (const line of content.split('\n')) {
    const task = parseTaskLine(line);
    if (!task) {
      textBuffer.push(line);
      continue;
    }
    flushText();
    const last = segments[segments.length - 1];
    if (last && last.kind === 'tasks') {
      last.items.push(task);
    } else {
      segments.push({ kind: 'tasks', items: [task] });
    }
  }
  flushText();

  return segments;
}

const statusConfig = {
  completed: {
    icon: (
      <svg className="h-3.5 w-3.5 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    textClass: 'line-through text-gray-400 dark:text-gray-500',
    badgeClass: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
  },
  in_progress: {
    icon: (
      <svg className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    textClass: 'text-gray-900 dark:text-gray-100',
    badgeClass: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
  },
  pending: {
    icon: (
      <svg className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" strokeWidth={2} />
      </svg>
    ),
    textClass: 'text-gray-700 dark:text-gray-300',
    badgeClass: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
  }
};

/**
 * Renders task list results with proper status icons and compact layout
 * Parses text content from TaskList/TaskGet results
 *
 * Rendered by chat's ToolRenderer as the content of a task-list tool result.
 */
export const TaskListContent: React.FC<TaskListContentProps> = ({ content }) => {
  const segments = parseTaskContent(content);
  const tasks = segments.flatMap((segment) => (segment.kind === 'tasks' ? segment.items : []));

  // Nothing parsed: fall back to the payload verbatim, exactly as before.
  if (tasks.length === 0) {
    return (
      <pre className="whitespace-pre-wrap font-mono text-[11px] text-gray-600 dark:text-gray-400">
        {content}
      </pre>
    );
  }

  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {completed}/{total} completed
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full rounded-full bg-green-500 transition-all dark:bg-green-400"
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      </div>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') {
          return (
            <pre
              key={`text-${index}`}
              className="whitespace-pre-wrap font-mono text-[11px] text-gray-600 dark:text-gray-400"
            >
              {segment.lines.join('\n')}
            </pre>
          );
        }
        return (
          <div key={`tasks-${index}`} className="space-y-px">
            {segment.items.map((task) => {
              const config = statusConfig[task.status] || statusConfig.pending;
              return (
                <div
                  key={task.id}
                  className="group flex items-center gap-1.5 py-0.5"
                >
                  <span className="flex-shrink-0">{config.icon}</span>
                  <span className="flex-shrink-0 font-mono text-[11px] text-gray-400 dark:text-gray-500">
                    #{task.id}
                  </span>
                  {/* `title` gives a truncated subject a hover outlet on desktop;
                      touch devices have none, which is recorded as a known limit. */}
                  <span className={`flex-1 truncate text-xs ${config.textClass}`} title={task.subject}>
                    {task.subject}
                  </span>
                  <span className={`flex-shrink-0 rounded border px-1 py-px text-[10px] ${config.badgeClass}`}>
                    {task.status.replace('_', ' ')}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
