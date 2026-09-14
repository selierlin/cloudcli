import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BashCommandDisplay } from '@/modules/chat/tools/BashCommandDisplay';
import { OneLineDisplay } from '@/modules/chat/tools/OneLineDisplay';
import { ToolRenderer } from '@/modules/chat/tools/ToolRenderer';
import { createCachedDiffCalculator } from '@/modules/chat/utils/messageTransforms';

// jsdom ships no CSS engine, so `getComputedStyle` cannot resolve Tailwind
// classes and returns the browser default for every property. These tests
// therefore assert the class tokens that *encode* the single-line requirement
// (`whitespace-nowrap` + `overflow-x-auto`) rather than computed values.
// Behaviour that only exists in a real layout engine — that a long command
// actually scrolls — is covered by the transcript Playwright suite.

const createDiff = createCachedDiffCalculator();

const serializeToolInput = (toolInput: Record<string, unknown>) =>
  JSON.stringify(toolInput, null, 2);

/**
 * The deepest element whose text ends with the command. The Bash row renders
 * the command in a leaf span; the PowerShell row nests it after a `$ ` prefix,
 * so matching on a suffix covers both without a test-only attribute.
 */
const commandNode = (container: HTMLElement, command: string): HTMLElement => {
  const matches = Array.from(container.querySelectorAll<HTMLElement>('*'))
    .filter((element) => element.textContent?.endsWith(command));
  const node = matches[matches.length - 1];
  if (!node) throw new Error(`no element renders the command ${JSON.stringify(command)}`);
  return node;
};

describe('Bash command row stays on one line', () => {
  const multiLineCommand = 'git commit -m "a\nb"';

  it('renders the collapsed command with nowrap and a horizontal scroll outlet', () => {
    const { container } = render(<BashCommandDisplay command={multiLineCommand} />);
    const node = commandNode(container, multiLineCommand);

    expect(node.className).toContain('whitespace-nowrap');
    expect(node.className).toContain('overflow-x-auto');
    // `whitespace-pre` would break at the newline and defeat the whole change.
    expect(node.className).not.toContain('whitespace-pre-wrap');
    expect(node.className).not.toContain('truncate');
  });

  it('wraps the command when the output is expanded', () => {
    const { container } = render(
      <BashCommandDisplay command={multiLineCommand} output={'one\ntwo'} status="completed" />,
    );
    const collapsed = commandNode(container, multiLineCommand).className;
    expect(collapsed).toContain('whitespace-nowrap');
    expect(collapsed).not.toContain('whitespace-pre-wrap');

    fireEvent.click(container.querySelector('[role="button"]') as HTMLElement);

    const expanded = commandNode(container, multiLineCommand).className;
    expect(expanded).toContain('whitespace-pre-wrap');
    expect(expanded).not.toContain('whitespace-nowrap');

    // The output stays a terminal surface: source line structure, scrolls.
    const output = container.querySelector('pre');
    expect(output?.className).toContain('tool-terminal-output');
  });

  it('copies the original command, not the whitespace-collapsed rendering', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { container } = render(<BashCommandDisplay command={multiLineCommand} />);
    fireEvent.click(container.querySelector('button') as HTMLElement);

    expect(writeText).toHaveBeenCalledWith(multiLineCommand);
  });
});

describe('Bash output is a terminal surface, not prose', () => {
  const command = 'ps aux';
  const columnarOutput = [
    'USER   PID  %CPU  COMMAND',
    'root     1   0.0  /sbin/launchd --with-a-very-long-flag=aaaaaaaaaaaaaaaaaaaaaaaaaa',
  ].join('\n');

  it('keeps the expanded output on its source lines with a scroll outlet', () => {
    const { container } = render(
      <BashCommandDisplay command={command} output={columnarOutput} status="completed" />,
    );
    fireEvent.click(container.querySelector('[role="button"]') as HTMLElement);

    const pre = container.querySelector('pre') as HTMLElement;
    expect(pre.className).toContain('tool-terminal-output');
    // The two classes that used to force the wrap, `break-all` included: it
    // broke inside tokens, which is what column alignment cannot survive.
    expect(pre.className).not.toContain('whitespace-pre-wrap');
    expect(pre.className).not.toContain('break-all');
    // The scroll outlet and the height cap are unchanged.
    expect(pre.className).toContain('overflow-auto');
    expect(pre.className).toContain('max-h-80');
    expect(pre.textContent).toBe(columnarOutput);
  });

  it('applies the same marker to a failed command output', () => {
    const { container } = render(
      <BashCommandDisplay command={command} output={columnarOutput} status="completed" isError />,
    );
    fireEvent.click(container.querySelector('[role="button"]') as HTMLElement);

    expect((container.querySelector('pre') as HTMLElement).className).toContain('tool-terminal-output');
  });

  it('leaves the collapsed error preview wrapping: it is a peek, not the output', () => {
    const { container } = render(
      <BashCommandDisplay command={command} output={columnarOutput} status="completed" isError />,
    );

    expect((container.querySelector('pre') as HTMLElement).className).not.toContain('tool-terminal-output');
  });

  it('renders no output surface at all while collapsed', () => {
    const { container } = render(
      <BashCommandDisplay command={command} output={columnarOutput} status="completed" />,
    );

    expect(container.querySelector('.tool-terminal-output')).toBeNull();
  });
});

describe('PowerShell terminal row stays on one line', () => {
  const multiLineCommand = 'npm run build\nnpm test';

  it('renders the command as a span, so the global code rule cannot force wrapping', () => {
    const { container } = render(
      <OneLineDisplay toolName="PowerShell" style="terminal" value={multiLineCommand} />,
    );
    const node = commandNode(container, multiLineCommand);

    // `.chat-message code { white-space: pre-wrap !important }` beats any
    // utility class, so this element must not be a <code>.
    expect(node.tagName).toBe('SPAN');
    expect(node.className).toContain('whitespace-nowrap');
    expect(node.className).toContain('overflow-x-auto');
  });

  it('routes the tool registry through the same single-line terminal row', () => {
    const { container } = render(
      <ToolRenderer
        toolName="PowerShell"
        toolInput={serializeToolInput({ command: multiLineCommand })}
        mode="input"
        createDiff={createDiff}
      />,
    );

    expect(commandNode(container, multiLineCommand).className).toContain('whitespace-nowrap');
  });
});

describe('non-terminal one-line rows are unchanged', () => {
  it('still truncates instead of wrapping', () => {
    const value = '/tmp/demo/a.js';
    const { container } = render(<OneLineDisplay toolName="Read" value={value} />);
    const node = commandNode(container, value);

    expect(node.className).toContain('truncate');
    expect(node.className).not.toContain('whitespace-pre-wrap');
  });
});
