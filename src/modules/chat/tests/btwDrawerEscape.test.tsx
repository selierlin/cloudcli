import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import BtwDrawer from '@/modules/chat/btw/BtwDrawer';
import type { BtwController } from '@/modules/chat/hooks/useBtwSession';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * The drawer closes on Escape, which is also the key a pinyin/Japanese input
 * cancels a candidate with. Without the IME guard the drawer vanishes mid-word
 * and takes the branch the user was writing into with it.
 */

const makeBtw = (): BtwController => ({
  sessionId: null,
  creating: false,
  closing: false,
  closeFailure: null,
  createError: null,
  anchorInfo: null,
  abort: () => {},
} as unknown as BtwController);

const renderDrawer = (onClose: () => void) => render(
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
    isProcessing={false}
    canAbort={false}
    sourceIsProcessing={false}
    anchorLabel={null}
    anchorNotice={null}
    permissionModeLabel="Default"
    permissionRequests={[]}
    onPermissionDecision={() => {}}
    onGrantToolPermission={() => ({ success: true })}
    onSend={async () => true}
    onClose={onClose}
    onRefork={() => {}}
    onPromote={() => {}}
    createDiff={() => []}
  />,
);

test('Escape that cancels an IME candidate leaves the drawer open', () => {
  const onClose = vi.fn();
  renderDrawer(onClose);

  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape', isComposing: true });

  expect(onClose).not.toHaveBeenCalled();
});

test('a plain Escape still closes the drawer', () => {
  const onClose = vi.fn();
  renderDrawer(onClose);

  fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });

  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the drawer carries the slot the global Escape handler looks up', () => {
  renderDrawer(vi.fn());

  // ChatInterface's capture-phase listener sorts a press by this attribute: a
  // press inside the drawer is left to the drawer, one outside still aborts the
  // watched turn. Nothing else guards the selector, so a rename would silently
  // make Escape do both.
  expect(screen.getByRole('complementary').getAttribute('data-slot')).toBe('btw-drawer');
});
