import { useCallback, useEffect, useRef, useState } from 'react';

import { useTheme } from '@/shared/context/ThemeContext';
import { api } from '@/shared/api';
import { setNotificationSoundEnabled, setNotificationVibrationEnabled } from '@/shared/utils';
import { WORKBUDDY_SETTINGS_STORAGE_KEY } from '@/shared/constants';
import {
  readCodeEditorSettings,
  writeCodeEditorSettings,
} from '@/shared/codeEditorSettings';
import {
  readUserPreference,
  writeUserPreferences,
} from '@/shared/userSettings';
import { useProviderAuthStatus } from '@/modules/provider-auth';
import type { AgentProvider, ClaudePermissionsState, CodeEditorSettingsState, CodexPermissionMode, CursorPermissionsState, DshPermissionMode, LLMProvider, NotificationPreferencesState, OpenclawPermissionMode, OmpPermissionMode, PermissionMode, PiPermissionMode, ProjectSortOrder, SettingsMainTab, WorkbuddyPermissionMode, ZcodePermissionMode } from '@/shared/types';

const DEFAULT_CURSOR_PERMISSIONS: CursorPermissionsState = {
  allowedCommands: [],
  disallowedCommands: [],
  skipPermissions: false,
};

type ThemeContextValue = {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
};

type UseSettingsControllerArgs = {
  isOpen: boolean;
  initialTab: string;
};

type ClaudeSettingsStorage = {
  allowedTools?: string[];
  disallowedTools?: string[];
  skipPermissions?: boolean;
  projectSortOrder?: ProjectSortOrder;
};

type CursorSettingsStorage = {
  allowedCommands?: string[];
  disallowedCommands?: string[];
  skipPermissions?: boolean;
};

type CodexSettingsStorage = {
  permissionMode?: CodexPermissionMode;
};

type WorkbuddySettingsStorage = {
  permissionMode?: WorkbuddyPermissionMode;
};

type DshSettingsStorage = {
  permissionMode?: DshPermissionMode;
};

type ZcodeSettingsStorage = {
  permissionMode?: ZcodePermissionMode;
};

type PiSettingsStorage = {
  permissionMode?: PiPermissionMode;
};

type OmpSettingsStorage = {
  permissionMode?: OmpPermissionMode;
};

type OpenclawSettingsStorage = {
  permissionMode?: OpenclawPermissionMode;
};

type NotificationPreferencesResponse = {
  success?: boolean;
  preferences?: NotificationPreferencesState;
};

type ActiveLoginProvider = AgentProvider | '';

const KNOWN_MAIN_TABS: SettingsMainTab[] = ['agents', 'appearance', 'chat', 'git', 'api', 'voice', 'quickReplies', 'tasks', 'browser', 'mcp', 'notifications', 'plugins', 'network', 'about'];

const normalizeMainTab = (tab: string): SettingsMainTab => {
  // Keep backwards compatibility with older callers that still pass "tools".
  if (tab === 'tools') {
    return 'agents';
  }

  return KNOWN_MAIN_TABS.includes(tab as SettingsMainTab) ? (tab as SettingsMainTab) : 'agents';
};

const toCodexPermissionMode = (value: unknown): CodexPermissionMode => {
  if (value === 'acceptEdits' || value === 'bypassPermissions') {
    return value;
  }

  return 'default';
};

const toWorkbuddyPermissionMode = (value: unknown): WorkbuddyPermissionMode => {
  if (value === 'acceptEdits' || value === 'bypassPermissions' || value === 'plan') {
    return value;
  }

  return 'default';
};

const toDshPermissionMode = (value: unknown): DshPermissionMode => (
  value === 'auto' ? 'auto' : 'default'
);

const toZcodePermissionMode = (value: unknown): ZcodePermissionMode => {
  if (value === 'acceptEdits' || value === 'bypassPermissions' || value === 'plan') {
    return value;
  }

  // ZCode's own default is `edit` (acceptEdits), unlike the other mode pickers.
  return 'acceptEdits';
};

const toPiPermissionMode = (value: unknown): PiPermissionMode => {
  if (value === 'readonly') {
    return value;
  }

  return 'default';
};

const toOmpPermissionMode = (value: unknown): OmpPermissionMode => {
  if (value === 'readonly') {
    return value;
  }

  return 'default';
};

const toOpenclawPermissionMode = (value: unknown): OpenclawPermissionMode => (
  value === 'auto' ? 'auto' : 'default'
);

const readWorkbuddyPermissionMode = (): WorkbuddyPermissionMode => {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKBUDDY_SETTINGS_STORAGE_KEY) || '{}') as WorkbuddySettingsStorage;
    return toWorkbuddyPermissionMode(stored.permissionMode);
  } catch {
    return 'default';
  }
};

/**
 * Wraps a provider's permission-mode state setter so that editing the setting
 * also drops the composer's provider-level "last used" override.
 *
 * The composer resolves a chat's mode as session pick > provider pick >
 * settings default, so without this drop a mode picked during an earlier chat
 * would keep shadowing the default the user just saved.
 */
const usePermissionModeSetter = <T extends PermissionMode>(
  provider: LLMProvider,
  setStoredValue: (value: T) => void,
): ((value: T) => void) => useCallback((value: T) => {
  setStoredValue(value);
  localStorage.removeItem(`permissionMode-last-${provider}`);
}, [provider, setStoredValue]);

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const createEmptyClaudePermissions = (): ClaudePermissionsState => ({
  allowedTools: [],
  disallowedTools: [],
  skipPermissions: false,
});

const createEmptyCursorPermissions = (): CursorPermissionsState => ({
  ...DEFAULT_CURSOR_PERMISSIONS,
});

const createDefaultNotificationPreferences = (): NotificationPreferencesState => ({
  channels: {
    inApp: true,
    webPush: false,
    desktop: false,
    sound: true,
    vibration: true,
  },
  events: {
    actionRequired: true,
    stop: true,
    error: true,
  },
});

const normalizeNotificationPreferences = (
  preferences?: Partial<NotificationPreferencesState> | null,
): NotificationPreferencesState => {
  const defaults = createDefaultNotificationPreferences();

  return {
    channels: {
      inApp: preferences?.channels?.inApp ?? defaults.channels.inApp,
      webPush: preferences?.channels?.webPush ?? defaults.channels.webPush,
      desktop: preferences?.channels?.desktop ?? defaults.channels.desktop,
      sound: preferences?.channels?.sound ?? defaults.channels.sound,
      vibration: preferences?.channels?.vibration ?? defaults.channels.vibration,
    },
    events: {
      actionRequired: preferences?.events?.actionRequired ?? defaults.events.actionRequired,
      stop: preferences?.events?.stop ?? defaults.events.stop,
      error: preferences?.events?.error ?? defaults.events.error,
    },
  };
};

export function useSettingsController({ isOpen, initialTab }: UseSettingsControllerArgs) {
  const { isDarkMode, toggleDarkMode } = useTheme() as ThemeContextValue;
  const closeTimerRef = useRef<number | null>(null);

  const [activeTab, setActiveTab] = useState<SettingsMainTab>(() => normalizeMainTab(initialTab));
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  // Auto-save stays disabled until the current dialog opening has finished
  // loading its persisted values, which must become the comparison baseline.
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('date');
  const [codeEditorSettings, setCodeEditorSettings] = useState<CodeEditorSettingsState>(() => (
    readCodeEditorSettings()
  ));

  const [claudePermissions, setClaudePermissions] = useState<ClaudePermissionsState>(() => (
    createEmptyClaudePermissions()
  ));
  const [cursorPermissions, setCursorPermissions] = useState<CursorPermissionsState>(() => (
    createEmptyCursorPermissions()
  ));
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferencesState>(() => (
    createDefaultNotificationPreferences()
  ));
  const [codexPermissionMode, setCodexPermissionModeState] = useState<CodexPermissionMode>('default');
  const [workbuddyPermissionMode, setWorkbuddyPermissionModeState] = useState<WorkbuddyPermissionMode>(
    readWorkbuddyPermissionMode,
  );
  const [zcodePermissionMode, setZcodePermissionModeState] = useState<ZcodePermissionMode>('acceptEdits');
  const [piPermissionMode, setPiPermissionModeState] = useState<PiPermissionMode>('default');
  const [dshPermissionMode, setDshPermissionModeState] = useState<DshPermissionMode>('default');
  /** OMP's stored default mode, edited by the omp permission panel and used as the composer's fallback for OMP chats. */
  const [ompPermissionMode, setOmpPermissionModeState] = useState<OmpPermissionMode>('default');
  /** OpenClaw's stored default mode, edited by the openclaw permission panel and used as the composer's fallback for OpenClaw chats. */
  const [openclawPermissionMode, setOpenclawPermissionModeState] = useState<OpenclawPermissionMode>('default');

  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState<ActiveLoginProvider>('');
  const autoSaveTimerRef = useRef<number | null>(null);
  const lastAutoSavedKeyRef = useRef<string | null>(null);
  const {
    providerAuthStatus,
    checkProviderAuthStatus,
    refreshProviderAuthStatuses,
  } = useProviderAuthStatus();

  const loadSettings = useCallback(async () => {
    try {
      const savedClaudeSettings = readUserPreference<ClaudeSettingsStorage>('claudePermissions', {});
      setClaudePermissions({
        allowedTools: savedClaudeSettings.allowedTools || [],
        disallowedTools: savedClaudeSettings.disallowedTools || [],
        skipPermissions: Boolean(savedClaudeSettings.skipPermissions),
      });
      setProjectSortOrder(readUserPreference<ProjectSortOrder>('projectSortOrder', 'date') === 'name' ? 'name' : 'date');

      const savedCursorSettings = readUserPreference<CursorSettingsStorage>('cursorPermissions', {});
      setCursorPermissions({
        allowedCommands: savedCursorSettings.allowedCommands || [],
        disallowedCommands: savedCursorSettings.disallowedCommands || [],
        skipPermissions: Boolean(savedCursorSettings.skipPermissions),
      });

      const savedCodexSettings = readUserPreference<CodexSettingsStorage>('codexPermissions', {});
      setCodexPermissionModeState(toCodexPermissionMode(savedCodexSettings.permissionMode));
      setWorkbuddyPermissionModeState(readWorkbuddyPermissionMode());

      const savedZcodeSettings = readUserPreference<ZcodeSettingsStorage>('zcodePermissions', {});
      setZcodePermissionModeState(toZcodePermissionMode(savedZcodeSettings.permissionMode));
      const savedPiSettings = readUserPreference<PiSettingsStorage>('piPermissions', {});
      setPiPermissionModeState(toPiPermissionMode(savedPiSettings.permissionMode));
      const savedDshSettings = readUserPreference<DshSettingsStorage>('dshPermissions', {});
      setDshPermissionModeState(toDshPermissionMode(savedDshSettings.permissionMode));
      const savedOmpSettings = readUserPreference<OmpSettingsStorage>('ompPermissions', {});
      setOmpPermissionModeState(toOmpPermissionMode(savedOmpSettings.permissionMode));
      const savedOpenclawSettings = readUserPreference<OpenclawSettingsStorage>('openclawPermissions', {});
      setOpenclawPermissionModeState(toOpenclawPermissionMode(savedOpenclawSettings.permissionMode));

      try {
        const notificationResponse = await api.settings.notificationPreferences();
        if (notificationResponse.ok) {
          const notificationData = await toResponseJson<NotificationPreferencesResponse>(notificationResponse);
          if (notificationData.success && notificationData.preferences) {
            setNotificationPreferences(normalizeNotificationPreferences(notificationData.preferences));
          } else {
            setNotificationPreferences(createDefaultNotificationPreferences());
          }
        } else {
          setNotificationPreferences(createDefaultNotificationPreferences());
        }
      } catch {
        setNotificationPreferences(createDefaultNotificationPreferences());
      }

    } catch (error) {
      console.error('Error loading settings:', error);
      setClaudePermissions(createEmptyClaudePermissions());
      setCursorPermissions(createEmptyCursorPermissions());
      setNotificationPreferences(createDefaultNotificationPreferences());
      setCodexPermissionModeState('default');
      setWorkbuddyPermissionModeState('default');
      setZcodePermissionModeState('acceptEdits');
      setPiPermissionModeState('default');
      setDshPermissionModeState('default');
      setOmpPermissionModeState('default');
      setOpenclawPermissionModeState('default');
      setProjectSortOrder('date');
    }
  }, []);

  const openLoginForProvider = useCallback((provider: AgentProvider) => {
    setLoginProvider(provider);
    setShowLoginModal(true);
  }, []);

  const handleLoginComplete = useCallback((exitCode: number) => {
    if (!loginProvider) {
      return;
    }

    void (async () => {
      const authStatus = await checkProviderAuthStatus(loginProvider);

      if (exitCode !== 0) {
        console.warn(`Login process exited with code ${exitCode}; refreshing auth status before setting save status.`);
      }

      setSaveStatus(authStatus.authenticated ? 'success' : 'error');
    })();
  }, [checkProviderAuthStatus, loginProvider]);

  const saveSettings = useCallback(async () => {
    setSaveStatus(null);

    try {
      // One call so the whole dialog's state reaches the server as a single
      // merge-patch rather than four racing requests.
      writeUserPreferences({
        claudePermissions: {
          allowedTools: claudePermissions.allowedTools,
          disallowedTools: claudePermissions.disallowedTools,
          skipPermissions: claudePermissions.skipPermissions,
        },
        projectSortOrder,
        cursorPermissions: {
          allowedCommands: cursorPermissions.allowedCommands,
          disallowedCommands: cursorPermissions.disallowedCommands,
          skipPermissions: cursorPermissions.skipPermissions,
        },
        codexPermissions: {
          permissionMode: codexPermissionMode,
        },
        zcodePermissions: {
          permissionMode: zcodePermissionMode,
        },
        piPermissions: {
          permissionMode: piPermissionMode,
        },
        dshPermissions: {
          permissionMode: dshPermissionMode,
        },
        ompPermissions: {
          permissionMode: ompPermissionMode,
        },
        openclawPermissions: {
          permissionMode: openclawPermissionMode,
        },
      });
      localStorage.setItem(WORKBUDDY_SETTINGS_STORAGE_KEY, JSON.stringify({ permissionMode: workbuddyPermissionMode }));

      const notificationResponse = await api.settings.saveNotificationPreferences(
        notificationPreferences,
      );
      if (!notificationResponse.ok) {
        throw new Error('Failed to save notification preferences');
      }

      setSaveStatus('success');
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveStatus('error');
    }
  }, [
    claudePermissions.allowedTools,
    claudePermissions.disallowedTools,
    claudePermissions.skipPermissions,
    codexPermissionMode,
    workbuddyPermissionMode,
    zcodePermissionMode,
    piPermissionMode,
    dshPermissionMode,
    ompPermissionMode,
    openclawPermissionMode,
    cursorPermissions.allowedCommands,
    cursorPermissions.disallowedCommands,
    cursorPermissions.skipPermissions,
    notificationPreferences,
    projectSortOrder,
  ]);

  // Persist on the user's edit rather than in an effect keyed on the settings
  // object. The effect form also ran on mount, so merely opening this dialog
  // rewrote all four keys — which reset the editor's font size for anyone who
  // had never changed it.
  //
  // The other three keys are merged from storage rather than from the rendered
  // state, so two edits landing in one React batch cannot write the second one
  // on top of a pre-first-edit snapshot. Storage is the newest value because
  // this is the only writer that can be behind — the editor's own wordWrap
  // mirror in useCodeEditorSettings only ever writes back what it just read.
  const updateCodeEditorSetting = useCallback(
    <K extends keyof CodeEditorSettingsState>(key: K, value: CodeEditorSettingsState[K]) => {
      const next = { ...readCodeEditorSettings(), [key]: value };
      setCodeEditorSettings(next);
      writeCodeEditorSettings(next);
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      setSettingsHydrated(false);
      lastAutoSavedKeyRef.current = null;
      return;
    }

    let isCurrentOpening = true;
    setSettingsHydrated(false);
    lastAutoSavedKeyRef.current = null;
    setActiveTab(normalizeMainTab(initialTab));
    void loadSettings().finally(() => {
      if (isCurrentOpening) {
        setSettingsHydrated(true);
      }
    });
    void refreshProviderAuthStatuses();

    return () => {
      isCurrentOpening = false;
    };
  }, [initialTab, isOpen, loadSettings, refreshProviderAuthStatuses]);

  useEffect(() => {
    setNotificationSoundEnabled(notificationPreferences.channels.sound);
  }, [notificationPreferences.channels.sound]);

  useEffect(() => {
    setNotificationVibrationEnabled(notificationPreferences.channels.vibration);
  }, [notificationPreferences.channels.vibration]);

  const autoSaveSnapshotKey = JSON.stringify([
    claudePermissions.allowedTools,
    claudePermissions.disallowedTools,
    claudePermissions.skipPermissions,
    cursorPermissions.allowedCommands,
    cursorPermissions.disallowedCommands,
    cursorPermissions.skipPermissions,
    codexPermissionMode,
    workbuddyPermissionMode,
    zcodePermissionMode,
    piPermissionMode,
    dshPermissionMode,
    ompPermissionMode,
    openclawPermissionMode,
    notificationPreferences,
    projectSortOrder,
  ]);

  // The values loaded for this opening are the baseline, not a user edit.
  useEffect(() => {
    if (isOpen && settingsHydrated && lastAutoSavedKeyRef.current === null) {
      lastAutoSavedKeyRef.current = autoSaveSnapshotKey;
    }
  }, [autoSaveSnapshotKey, isOpen, settingsHydrated]);

  useEffect(() => {
    if (
      !isOpen
      || !settingsHydrated
      || lastAutoSavedKeyRef.current === null
      || lastAutoSavedKeyRef.current === autoSaveSnapshotKey
    ) {
      return;
    }

    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(() => {
      lastAutoSavedKeyRef.current = autoSaveSnapshotKey;
      saveSettings();
    }, 500);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [autoSaveSnapshotKey, isOpen, saveSettings, settingsHydrated]);

  // Changing a stored default must not be masked by the composer's last
  // selection for that provider, so each setter drops the provider-level
  // override the composer writes when a mode is picked during a chat.
  const setCodexPermissionMode = usePermissionModeSetter<CodexPermissionMode>('codex', setCodexPermissionModeState);
  const setWorkbuddyPermissionMode = usePermissionModeSetter<WorkbuddyPermissionMode>('workbuddy', setWorkbuddyPermissionModeState);
  const setZcodePermissionMode = usePermissionModeSetter<ZcodePermissionMode>('zcode', setZcodePermissionModeState);
  const setPiPermissionMode = usePermissionModeSetter<PiPermissionMode>('pi', setPiPermissionModeState);
  const setDshPermissionMode = usePermissionModeSetter<DshPermissionMode>('dsh', setDshPermissionModeState);
  const setOmpPermissionMode = usePermissionModeSetter<OmpPermissionMode>('omp', setOmpPermissionModeState);
  const setOpenclawPermissionMode = usePermissionModeSetter<OpenclawPermissionMode>('openclaw', setOpenclawPermissionModeState);

  // Clear save status after 2 seconds
  useEffect(() => {
    if (saveStatus === null) {
      return;
    }

    const timer = window.setTimeout(() => setSaveStatus(null), 2000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  return {
    activeTab,
    setActiveTab,
    isDarkMode,
    toggleDarkMode,
    saveStatus,
    projectSortOrder,
    setProjectSortOrder,
    codeEditorSettings,
    updateCodeEditorSetting,
    claudePermissions,
    setClaudePermissions,
    cursorPermissions,
    setCursorPermissions,
    notificationPreferences,
    setNotificationPreferences,
    codexPermissionMode,
    setCodexPermissionMode,
    workbuddyPermissionMode,
    setWorkbuddyPermissionMode,
    zcodePermissionMode,
    setZcodePermissionMode,
    piPermissionMode,
    setPiPermissionMode,
    dshPermissionMode,
    setDshPermissionMode,
    ompPermissionMode,
    setOmpPermissionMode,
    openclawPermissionMode,
    setOpenclawPermissionMode,
    providerAuthStatus,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    handleLoginComplete,
  };
}
