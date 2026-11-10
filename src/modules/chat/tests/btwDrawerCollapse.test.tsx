import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import BtwDrawer from '@/modules/chat/btw/BtwDrawer';
import type { BtwController } from '@/modules/chat/hooks/useBtwSession';
import type { SideAskPlacement } from '@/modules/chat/hooks/useSideAskPlacement';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * Collapsing is how the reader gets the main conversation back without ending
 * the branch: it has to exist in every layout, including the phone sheet, where
 * the panel would otherwise block the composer entirely. Collapsing must never
 * be confused with closing, which deletes the branch.
 */

const makeBtw = (): BtwController => ({
  sessionId: 'aside-1',
  creating: false,
  closing: false,
  closeFailure: null,
  createError: null,
  anchorInfo: null,
  abort: () => {},
} as unknown as BtwController);

const renderDrawer = ({
  placement = 'overlay' as SideAskPlacement,
  minimized = false,
  isProcessing = false,
  restoredPartial = false,
  onMinimize = () => {},
  onRestore = () => {},
}: {
  placement?: SideAskPlacement;
  minimized?: boolean;
  isProcessing?: boolean;
  restoredPartial?: boolean;
  onMinimize?: () => void;
  onRestore?: () => void;
} = {}) => render(
  <BtwDrawer
    open
    btw={makeBtw()}
    placement={placement}
    minimized={minimized}
    restoredPartial={restoredPartial}
    onMinimize={onMinimize}
    onRestore={onRestore}
    sourceTitle="Source conversation"
    provider="claude"
    selectedProject={null}
    messages={[]}
    isProcessing={isProcessing}
    canAbort={false}
    sourceIsProcessing={false}
    anchorLabel={null}
    anchorNotice={null}
    permissionModeLabel="Default"
    modelLabel={null}
    activity={null}
    onAbort={() => {}}
    permissionRequests={[]}
    onPermissionDecision={() => {}}
    onGrantToolPermission={() => ({ success: true })}
    onSend={async () => true}
    onClose={() => {}}
    onRefork={() => {}}
    onPromote={() => {}}
    createDiff={() => []}
  />,
);

test.each<SideAskPlacement>(['docked', 'overlay', 'sheet'])(
  'a %s drawer can be collapsed',
  (placement) => {
    const onMinimize = vi.fn();
    renderDrawer({ placement, onMinimize });

    fireEvent.click(screen.getByRole('button', { name: 'sideAsk.minimize' }));

    expect(onMinimize).toHaveBeenCalledTimes(1);
  },
);

test('a collapsed drawer leaves a tab that names the branch and restores it', () => {
  const onRestore = vi.fn();
  renderDrawer({ minimized: true, onRestore });

  // The tab is the only control left, so it has to be the accessible name the
  // reader can find, not just an icon.
  const tab = screen.getByRole('button', { name: 'sideAsk.restore' });
  expect(tab.textContent).toContain('sideAsk.title');

  fireEvent.click(tab);
  expect(onRestore).toHaveBeenCalledTimes(1);
});

test('a collapsed branch that is still running says so', () => {
  renderDrawer({ minimized: true, isProcessing: true });

  const tab = screen.getByRole('button', { name: 'sideAsk.restore' });
  expect(tab.querySelector('[class*="animate-pulse"]')).not.toBeNull();
});

test('the panel leaves the keyboard offset to the workspace shell', () => {
  renderDrawer({ placement: 'sheet' });

  // The shell already sits on `bottom: var(--keyboard-height)`, so the column
  // ends above the keyboard. Subtracting the height here as well lifted the
  // composer into the middle of the transcript on iOS.
  const drawer = screen.getByRole('complementary');
  expect(drawer.getAttribute('style')).toBeNull();
  expect(drawer.className).toContain('h-full');
});

test('a branch restored without its earliest turns says so, collapsed', () => {
  renderDrawer({ restoredPartial: true });

  // The reader has to know the list starts partway through, but the reason is
  // a one-time footnote: it stays folded into the header until asked for.
  const summary = screen.getByText('sideAsk.restoredPartial');
  const disclosure = summary.closest('details');
  expect(disclosure).not.toBeNull();
  expect(disclosure?.hasAttribute('open')).toBe(false);
  expect(disclosure?.textContent).toContain('sideAsk.restoredPartialHint');
});

test('a branch that came back whole stays quiet', () => {
  renderDrawer();

  expect(screen.queryByText('sideAsk.restoredPartial')).toBeNull();
});

test('a running branch shows what it is doing, for how long, with a way to stop it', () => {
  // The drawer has no composer of its own, so this indicator is the only sign
  // that a question is being answered.
  render(
    <BtwDrawer
      open
      btw={makeBtw()}
      placement="overlay"
      minimized={false}
      onMinimize={() => {}}
      onRestore={() => {}}
      sourceTitle="Source conversation"
      provider="claude"
      selectedProject={null}
      messages={[]}
      isProcessing
      canAbort
      activity={{ statusText: null, canInterrupt: true, startedAt: Date.now() - 5000 }}
      onAbort={() => {}}
      sourceIsProcessing={false}
      anchorLabel={null}
      anchorNotice={null}
      permissionModeLabel="Default"
      modelLabel={null}
      permissionRequests={[]}
      onPermissionDecision={() => {}}
      onGrantToolPermission={() => ({ success: true })}
      onSend={async () => true}
      onClose={() => {}}
      onRefork={() => {}}
      onPromote={() => {}}
      createDiff={() => []}
    />,
  );

  const tab = document.querySelector('[data-slot="activity-tab"]');
  expect(tab).toBeTruthy();
  // The elapsed clock is what tells a reader the wait is progressing.
  expect(screen.getByText(/5s|{{count}}s|seconds/)).toBeTruthy();
  expect(screen.getByLabelText('claudeStatus.stop')).toBeTruthy();
});

test('an idle branch shows no indicator', () => {
  renderDrawer({});

  expect(document.querySelector('[data-slot="activity-tab"]')).toBeNull();
});
