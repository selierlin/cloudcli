import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';

// Voice UI is gated by two independent preferences (voice input / read aloud) plus a
// reachable voice backend. Each caller reads only the flag it needs.
let healthRequest: Promise<boolean> | null = null;

function checkVoiceHealth(): Promise<boolean> {
  if (healthRequest) return healthRequest;
  const request = api.voice.health()
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      const data = await response.json();
      return data?.configured === true;
    })
    .finally(() => {
      healthRequest = null;
    });
  healthRequest = request;
  return request;
}

/** Which voice affordances should render. Local to this hook, its only definer. */
type VoiceAvailability = {
  /** Mic/dictation: `voiceInputEnabled` set and a backend reachable. */
  canDictate: boolean;
  /** Read-aloud: `voiceOutputEnabled` set and a backend reachable. */
  canSpeak: boolean;
};

export function useVoiceAvailable(): VoiceAvailability {
  const { voiceInputEnabled, voiceOutputEnabled } = useUiPreferences();
  // Whether a voice backend is actually reachable — either the user configured a base
  // URL or the server reports one. Independent of the two on/off preferences, so a
  // toggle flip reuses the last result instead of re-probing.
  const [backendReady, setBackendReady] = useState(false);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const check = async () => {
      // Nothing to probe while both affordances are off.
      if (!voiceInputEnabled && !voiceOutputEnabled) {
        setBackendReady(false);
        return;
      }
      if (readVoiceConfig().baseUrl.trim()) {
        setBackendReady(true);
        return;
      }
      const id = ++requestId;
      try {
        const result = await checkVoiceHealth();
        if (active && id === requestId) setBackendReady(result);
      } catch {
        if (active && id === requestId) setBackendReady(false);
      }
    };

    void check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    };
  }, [voiceInputEnabled, voiceOutputEnabled]);

  return {
    canDictate: voiceInputEnabled && backendReady,
    canSpeak: voiceOutputEnabled && backendReady,
  };
}
