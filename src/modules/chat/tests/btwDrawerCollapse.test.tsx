import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import BtwDrawer from '@/modules/chat/btw/BtwDrawer';
import type { BtwController } from '@/modules/chat/hooks/useBtwSession';
import type { SideAskPlacement } from '@/modules/chat/hooks/useSideAskPlacement';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * Collapsing is the overlay's escape hatch from covering 420px of the
 * transcript. It must not exist where the transcript is already visible
 * (docked) or where the drawer is the whole column (sheet), and collapsing must
 * never be confused with closing, which deletes the branch.
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
  onMinimize,
  onRestore = () => {},
}: {
  placement?: SideAskPlacement;
  minimized?: boolean;
  isProcessing?: boolean;
  onMinimize?: () => void;
  onRestore?: () => void;
} = {}) => render(
  <BtwDrawer
    open
    btw={makeBtw()}
    placement={placement}
    minimized={minimized}
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

test('an overlay can be collapsed', () => {
  const onMinimize = vi.fn();
  renderDrawer({ onMinimize });

  fireEvent.click(screen.getByRole('button', { name: 'sideAsk.minimize' }));

  expect(onMinimize).toHaveBeenCalledTimes(1);
});

test('a docked drawer offers no collapse, because nothing is covered', () => {
  renderDrawer({ placement: 'docked' });

  expect(screen.queryByRole('button', { name: 'sideAsk.minimize' })).toBeNull();
});

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
