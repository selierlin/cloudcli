import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import QuickSettingsPanelView from '@/modules/quick-settings-panel/QuickSettingsPanelView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/shared/hooks/useDeviceSettings', () => ({
  useDeviceSettings: () => ({ isMobile: false }),
}));

vi.mock('@/modules/project-workspace', () => ({
  useProjectMainState: () => ({
    selectedProject: null,
    selectedSession: null,
    handleSessionSelect: vi.fn(),
  }),
}));

vi.mock('@/modules/quick-settings-panel/hooks/useQuickSettingsDrag', () => ({
  useQuickSettingsDrag: () => ({
    isDragging: false,
    handleStyle: {},
    startDrag: vi.fn(),
    handlePointerMove: vi.fn(),
    endDrag: vi.fn(),
    consumeSuppressedClick: () => false,
  }),
}));

vi.mock('@/modules/quick-settings-panel/hooks/useSessionOutlineData', () => ({
  useSessionOutlineData: () => ({ outlineItems: [], chatMessages: [], isLoading: false }),
}));

vi.mock('@/modules/quick-settings-panel/QuickSettingsHandle', () => ({ default: () => null }));
vi.mock('@/modules/quick-settings-panel/QuickSettingsPanelHeader', () => ({ default: () => null }));
vi.mock('@/modules/quick-settings-panel/QuickSettingsContent', () => ({
  default: () => <div data-testid="quick-settings-content" />,
}));
vi.mock('@/modules/quick-settings-panel/QuickSettingsOutline', () => ({ default: () => null }));

// The panel state is driven here so both dismiss channels can be exercised in
// both modes; the reducer itself is covered by quickSettingsPanelState.test.ts.
const panelState = vi.hoisted(() => ({
  close: vi.fn(),
  isOpen: true,
  isPinned: false,
}));

vi.mock('@/modules/quick-settings-panel/hooks/useQuickSettingsPanelState', () => ({
  useQuickSettingsPanelState: () => ({
    isOpen: panelState.isOpen,
    isPinned: panelState.isPinned,
    activeTab: 'settings',
    close: panelState.close,
    toggle: vi.fn(),
    selectTab: vi.fn(),
    togglePin: vi.fn(),
  }),
}));

/**
 * Mirrors what `DialogContent` portals to the body: one layer holding the
 * content card and, as a sibling, the overlay that closes on click.
 */
const mountDialogLayer = () => {
  const layer = document.createElement('div');
  layer.setAttribute('data-dialog-layer', '');

  const overlay = document.createElement('div');
  const content = document.createElement('div');
  content.setAttribute('role', 'dialog');
  content.appendChild(document.createElement('button'));

  layer.append(overlay, content);
  document.body.appendChild(layer);

  return { layer, overlay, content };
};

beforeEach(() => {
  panelState.close.mockClear();
  panelState.isOpen = true;
  panelState.isPinned = false;
  document.querySelectorAll('[data-dialog-layer]').forEach((node) => node.remove());
});

it.each([
  ['the dialog content', (layer: HTMLElement) => layer.querySelector('[role="dialog"]') as HTMLElement],
  ['the dialog overlay', (layer: HTMLElement) => layer.firstElementChild as HTMLElement],
])('keeps the overlay panel open on a mousedown inside %s', (_label, pick) => {
  render(<QuickSettingsPanelView selectedProject={null} />);
  const { layer } = mountDialogLayer();

  fireEvent.mouseDown(pick(layer));

  expect(panelState.close).not.toHaveBeenCalled();
});

it('keeps the overlay panel open on Escape inside a dialog', () => {
  render(<QuickSettingsPanelView selectedProject={null} />);
  mountDialogLayer();

  fireEvent.keyDown(document.body, { key: 'Escape' });

  expect(panelState.close).not.toHaveBeenCalled();
});

it('keeps the docked panel mounted on a mousedown inside a dialog', () => {
  panelState.isPinned = true;
  render(<QuickSettingsPanelView selectedProject={null} />);
  const { layer } = mountDialogLayer();

  fireEvent.mouseDown(layer.querySelector('[role="dialog"]') as HTMLElement);

  expect(panelState.close).not.toHaveBeenCalled();
  expect(screen.getByTestId('quick-settings-content')).toBeTruthy();
});

it('leaves Escape alone while docked, dialog or not', () => {
  panelState.isPinned = true;
  render(<QuickSettingsPanelView selectedProject={null} />);

  fireEvent.keyDown(document.body, { key: 'Escape' });

  // The docked panel installs no Escape listener at all; this pins that down so
  // a future "restore Escape for docked" change cannot slip in unnoticed.
  expect(panelState.close).not.toHaveBeenCalled();
});

it('closes the overlay panel on a mousedown outside it and outside any dialog', () => {
  render(<QuickSettingsPanelView selectedProject={null} />);
  const outside = document.createElement('div');
  document.body.appendChild(outside);

  fireEvent.mouseDown(outside);

  expect(panelState.close).toHaveBeenCalledTimes(1);
  outside.remove();
});

it('closes the overlay panel on Escape when no dialog is open', () => {
  render(<QuickSettingsPanelView selectedProject={null} />);

  fireEvent.keyDown(document.body, { key: 'Escape' });

  expect(panelState.close).toHaveBeenCalledTimes(1);
});
