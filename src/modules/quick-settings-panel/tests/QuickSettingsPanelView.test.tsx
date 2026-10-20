import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

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
    handleStyle: { top: '50%' },
    startDrag: vi.fn(),
    handlePointerMove: vi.fn(),
    endDrag: vi.fn(),
    consumeSuppressedClick: () => false,
  }),
}));

vi.mock('@/modules/quick-settings-panel/hooks/useSessionOutlineData', () => ({
  useSessionOutlineData: () => ({
    outlineItems: [],
    chatMessages: [],
    isLoading: false,
  }),
}));

const handleProps = vi.hoisted(() => ({ current: null as { openOffset?: number } | null }));

vi.mock('@/modules/quick-settings-panel/QuickSettingsHandle', () => ({
  default: (props: { openOffset?: number }) => {
    handleProps.current = props;
    return null;
  },
}));

vi.mock('@/modules/quick-settings-panel/QuickSettingsPanelHeader', () => ({
  default: () => null,
}));

vi.mock('@/modules/quick-settings-panel/QuickSettingsContent', () => ({
  default: () => <div data-testid="quick-settings-content" />,
}));

vi.mock('@/modules/quick-settings-panel/QuickSettingsOutline', () => ({
  default: () => <div data-testid="quick-settings-outline" />,
}));

it('renders the settings tab by default', () => {
  render(<QuickSettingsPanelView selectedProject={null} />);

  expect(screen.getByTestId('quick-settings-content')).toBeTruthy();
  expect(screen.queryByTestId('quick-settings-outline')).toBeNull();
});

// Pinning used to dock the panel 64px narrower than the overlay it replaced,
// which read as a bug: the stored width has to survive the switch.
it('pins to the same width the overlay opens with', () => {
  window.localStorage.setItem('quickSettingsPanelWidth', '420');
  window.localStorage.setItem('quickSettingsPanel', JSON.stringify({ pinned: true, tab: 'settings' }));

  const docked = render(<QuickSettingsPanelView selectedProject={null} />);
  const separator = screen.getByRole('separator');
  expect((separator.parentElement as HTMLElement).style.width).toBe('420px');
  // The edge handle sits at the panel's outer edge; a hardcoded 320px offset
  // would leave it floating inside a panel that was dragged wider.
  expect(handleProps.current?.openOffset).toBe(420);
  docked.unmount();

  window.localStorage.setItem('quickSettingsPanel', JSON.stringify({ pinned: false, tab: 'settings' }));
  render(<QuickSettingsPanelView selectedProject={null} />);
  // The wrapper sits above the panel body, which is the tabpanel's parent.
  const overlay = screen.getByRole('tabpanel').parentElement?.parentElement as HTMLElement;
  expect(overlay.style.width).toBe('420px');
  expect(handleProps.current?.openOffset).toBe(420);

  window.localStorage.removeItem('quickSettingsPanelWidth');
  window.localStorage.removeItem('quickSettingsPanel');
});
