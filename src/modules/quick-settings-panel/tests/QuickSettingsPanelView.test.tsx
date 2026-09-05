import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import QuickSettingsPanelView from '@/modules/quick-settings-panel/QuickSettingsPanelView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/shared/hooks/useDeviceSettings', () => ({
  useDeviceSettings: () => ({ isMobile: false }),
}));

vi.mock('@/shared/context/UiPreferencesContext', () => ({
  useUiPreferences: () => ({
    showRawParameters: false,
    showThinking: false,
    sendByCtrlEnter: false,
    voiceEnabled: false,
  }),
  useSetUiPreference: () => vi.fn(),
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

vi.mock('@/modules/quick-settings-panel/QuickSettingsHandle', () => ({
  default: () => null,
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

it('opens on the session outline tab', () => {
  render(<QuickSettingsPanelView />);

  expect(screen.getByTestId('quick-settings-outline')).toBeTruthy();
  expect(screen.queryByTestId('quick-settings-content')).toBeNull();
});
