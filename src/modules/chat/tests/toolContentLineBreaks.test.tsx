import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ToolErrorDisplay } from '@/modules/chat/tools/ToolErrorDisplay';
import { PlanDisplay } from '@/modules/chat/tools/PlanDisplay';
import { SubagentPanel } from '@/modules/chat/tools/SubagentPanel';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { MarkdownContent } from '@/modules/chat/tools/ContentRenderers/MarkdownContent';
import { TaskListContent } from '@/modules/chat/tools/ContentRenderers/TaskListContent';
import { QuestionAnswerContent } from '@/modules/chat/tools/ContentRenderers/QuestionAnswerContent';
import { ToolDiffViewer } from '@/modules/chat/tools/ToolDiffViewer';
import { QueueItem, QueueItemContent } from '@/modules/chat/tools/Queue';
import { TranscriptRenderContext } from '@/modules/chat/context/TranscriptRenderContext';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';

const createDiff = createCachedDiffCalculator();

/** The expanded error body: the only element that preserves the raw newlines. */
const expandedErrorBody = (container: HTMLElement): HTMLElement | null =>
  container.querySelector<HTMLElement>('[class*="whitespace-pre-wrap"]');

// A runtime error is not markdown. Markdown collapses a single `\n` into a
// space, so an unhandled stack trace arrives as one long paragraph.
describe('L1 error bodies keep their line structure', () => {
  const errorText = 'boom\n\nat foo (a.ts:1)\n\nat bar (b.ts:2)';

  it('renders the expanded error as pre-wrapped plain text, not markdown', () => {
    const { container } = render(<ToolErrorDisplay content={errorText} label="Error" />);

    expect(expandedErrorBody(container)).toBeNull();

    fireEvent.click(container.querySelector('[role="button"]') as HTMLElement);
    const body = expandedErrorBody(container);

    expect(body).not.toBeNull();
    expect(body?.textContent).toBe(errorText);
    // Internal blank lines survive; markdown would have joined them.
    expect(body?.textContent).toContain('\n\n');
    expect(body?.className).toContain('font-mono');
    // No markdown elements were produced from the payload.
    expect(body?.querySelector('p, strong, em, code, pre')).toBeNull();
  });

  it('renders the error body in an exported document without a click', () => {
    const { container } = render(
      <TranscriptRenderContext.Provider value={{ isExporting: true }}>
        <ToolErrorDisplay content={errorText} label="Error" />
      </TranscriptRenderContext.Provider>,
    );

    expect(expandedErrorBody(container)?.textContent).toBe(errorText);
  });
});

describe('L2 model-authored markdown honors single newlines', () => {
  const twoLines = 'line1\nline2';

  it('renders a single newline as a hard break when breaks is on', () => {
    const { container } = render(<MarkdownContent content={twoLines} breaks />);
    expect(container.querySelectorAll('br').length).toBeGreaterThan(0);
  });

  it('keeps the default off, so existing callers are unchanged', () => {
    const { container } = render(<MarkdownContent content={twoLines} />);
    expect(container.querySelectorAll('br').length).toBe(0);
  });

  it('passes breaks through the plan card', () => {
    const { container } = render(
      <PlanDisplay title="Plan" content={twoLines} toolName="ExitPlanMode" defaultOpen />,
    );
    expect(container.querySelectorAll('br').length).toBeGreaterThan(0);
  });

  it('passes breaks through the subagent result', () => {
    const { container } = render(
      <TranscriptRenderContext.Provider value={{ isExporting: true }}>
        <SubagentPanel
          toolInput={{ prompt: 'inspect' }}
          toolResult={{ content: twoLines }}
          subagent={{ id: 'a1', status: 'completed', activityCount: 1 }}
          activity={[]}
          createDiff={createDiff}
        />
      </TranscriptRenderContext.Provider>,
    );
    expect(container.querySelectorAll('br').length).toBeGreaterThan(0);
  });

  it('passes breaks through the markdown result branch of the tool registry', () => {
    const { container } = render(
      <ToolRenderer
        toolName="Task"
        toolInput={JSON.stringify({ prompt: 'inspect' }, null, 2)}
        toolResult={{ content: twoLines }}
        mode="result"
        createDiff={createDiff}
      />,
    );
    expect(container.querySelectorAll('br').length).toBeGreaterThan(0);
  });
});

/** The `#<id>` spans of the visualised task rows, in render order. */
const renderedTaskIds = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('span'))
    .map((element) => element.textContent ?? '')
    .filter((text) => /^#\d+$/.test(text));

// A task list result is a mix of machine-parseable rows and prose. The parser
// used to keep only the rows it understood and silently drop everything else.
describe('L4 task lists lose no lines and misread no prose', () => {
  it('renders parseable rows as a list and the rest as source text', () => {
    const content = [
      'Tasks:',
      '',
      '#15. [completed] First task',
      'Note: #99 is tracked elsewhere',
    ].join('\n');
    const { container } = render(<TaskListContent content={content} />);

    expect(renderedTaskIds(container)).toEqual(['#15']);
    expect(container.textContent).toContain('1/1 completed');
    // Neither the header nor the note was dropped.
    expect(container.textContent).toContain('Tasks:');
    expect(container.textContent).toContain('Note: #99 is tracked elsewhere');
  });

  it('renders a fully parseable payload as a list with no source block', () => {
    const content = [
      '#15. [completed] First task',
      '#16. [in_progress] Second task',
      '#17. [pending] Third task',
    ].join('\n');
    const { container } = render(<TaskListContent content={content} />);

    expect(renderedTaskIds(container)).toEqual(['#15', '#16', '#17']);
    expect(container.textContent).toContain('1/3 completed');
    expect(container.querySelector('pre')).toBeNull();
  });

  it('does not turn a prose reference into a task', () => {
    const content = ['#15. [completed] First task', 'Note: #99 is tracked elsewhere'].join('\n');
    const { container } = render(<TaskListContent content={content} />);

    expect(renderedTaskIds(container)).toEqual(['#15']);
    expect(container.textContent).toContain('1/1 completed');
  });

  it('still recognizes the list-prefix form declared by the source comment', () => {
    const content = ['- #15 [in_progress] Fix it (owner: agent)', '#16. [pending] Other'].join('\n');
    const { container } = render(<TaskListContent content={content} />);

    expect(renderedTaskIds(container)).toEqual(['#15', '#16']);
    expect(container.textContent).toContain('0/2 completed');
  });

  it('falls back to the raw payload when nothing parses', () => {
    const content = 'no tasks here\njust prose';
    const { container } = render(<TaskListContent content={content} />);

    expect(renderedTaskIds(container)).toEqual([]);
    expect(container.querySelector('pre')?.textContent).toBe(content);
  });
});

const classOf = (element: Element): string => element.getAttribute('class') ?? '';

// A 500-character token with no break opportunity used to be clipped by the
// card's `overflow-hidden` with no scroll outlet and no wrap.
describe('L5 diff lines stay reachable', () => {
  it('keeps a long line on one row and scrolls the body instead of wrapping', () => {
    const longLine = 'x'.repeat(500);
    const { container } = render(
      <ToolDiffViewer
        oldContent=""
        newContent={longLine}
        filePath="a.ts"
        createDiff={createDiff}
      />,
    );

    // Diff content is code, not prose: it holds its source line. Both
    // `whitespace-pre-wrap` and `break-words` would let it wrap and defeat the
    // row-width contract below.
    const rowSpan = Array.from(container.querySelectorAll('span'))
      .find((element) => classOf(element).split(/\s+/).includes('whitespace-pre'));
    expect(rowSpan).toBeDefined();
    expect(classOf(rowSpan as Element)).toContain('min-w-0');
    expect(classOf(rowSpan as Element)).not.toContain('whitespace-pre-wrap');
    expect(classOf(rowSpan as Element)).not.toContain('break-words');

    // `tool-diff-row` sizes the row to its longest line, which is what lets the
    // add/remove tint cover the whole line once scrolled and gives the gutter a
    // containing block to stick within.
    const row = rowSpan?.parentElement as Element;
    expect(classOf(row)).toContain('tool-diff-row');
    const gutter = row.querySelector('span') as Element;
    expect(classOf(gutter)).toContain('sticky');
    expect(classOf(gutter)).toContain('left-0');

    // The scroll outlet lives on the diff body, so the file header stays put.
    const diffBody = Array.from(container.querySelectorAll('div'))
      .find((element) => classOf(element).includes('leading-[18px]'));
    expect(diffBody).toBeDefined();
    expect(classOf(diffBody as Element)).toContain('overflow-x-auto');

    // The card keeps clipping for its rounded corners.
    expect(classOf(container.firstElementChild as Element)).toContain('overflow-hidden');
    expect(classOf(container.firstElementChild as Element)).not.toContain('overflow-x-auto');
  });
});

// A todo item or an answered question can carry a newline; a plain div
// collapses it into a space.
describe('L6 todo and question text keep their newlines', () => {
  it('preserves newlines in a queue item', () => {
    const { container } = render(
      <QueueItem status="pending">
        <QueueItemContent>{'line1\nline2'}</QueueItemContent>
      </QueueItem>,
    );

    const content = container.querySelector('[data-slot="queue-item-content"]') as Element;
    expect(classOf(content)).toContain('whitespace-pre-wrap');
    expect(classOf(content)).toContain('break-words');
  });

  it('preserves newlines in a question and its options', () => {
    const { container } = render(
      <QuestionAnswerContent
        questions={[{
          question: 'line1\nline2',
          options: [{ label: 'opt1\nopt2', description: 'desc1\ndesc2' }],
        }]}
        answers={{}}
      />,
    );

    // The option list is behind the expand toggle.
    fireEvent.click(container.querySelector('button') as HTMLElement);

    const withPreWrap = Array.from(container.querySelectorAll('*'))
      .filter((element) => classOf(element).includes('whitespace-pre-wrap'));
    // Question text, option label, option description.
    expect(withPreWrap.length).toBeGreaterThanOrEqual(3);
  });
});
