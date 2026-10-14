import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, test } from 'vitest';

import { useVoiceAvailable } from '@/modules/chat/hooks/useVoiceAvailable';
import { UiPreferencesProvider, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { resetUserPreferences } from '@/shared/userSettings';
import { VOICE_CONFIG_STORAGE_KEY } from '@/shared/voiceConfig';

/**
 * Voice input and read-aloud are switched independently, so the hook must report them
 * separately — hiding one affordance must never hide the other.
 */

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(UiPreferencesProvider, null, children);

/**
 * Point the voice config at a base URL so the hook resolves "backend ready" synchronously
 * and never issues the health request.
 */
const withConfiguredBackend = () => {
  localStorage.setItem(
    VOICE_CONFIG_STORAGE_KEY,
    JSON.stringify({ baseUrl: 'https://api.openai.com/v1' }),
  );
};

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton that outlives localStorage.clear().
  resetUserPreferences();
});

test('nothing is offered when no backend is configured', () => {
  const { result } = renderHook(() => useVoiceAvailable(), { wrapper });

  assert.deepEqual(result.current, { canDictate: false, canSpeak: false });
});

test('voice input alone offers dictation only', () => {
  withConfiguredBackend();
  const { result } = renderHook(
    () => ({ availability: useVoiceAvailable(), setPreference: useSetUiPreference() }),
    { wrapper },
  );

  act(() => {
    result.current.setPreference('voiceInputEnabled', true);
  });

  assert.deepEqual(result.current.availability, { canDictate: true, canSpeak: false });
});

test('read aloud alone offers speech only', () => {
  withConfiguredBackend();
  const { result } = renderHook(
    () => ({ availability: useVoiceAvailable(), setPreference: useSetUiPreference() }),
    { wrapper },
  );

  act(() => {
    result.current.setPreference('voiceOutputEnabled', true);
  });

  assert.deepEqual(result.current.availability, { canDictate: false, canSpeak: true });
});

test('both switches offer both affordances', () => {
  withConfiguredBackend();
  const { result } = renderHook(
    () => ({ availability: useVoiceAvailable(), setPreference: useSetUiPreference() }),
    { wrapper },
  );

  act(() => {
    result.current.setPreference('voiceInputEnabled', true);
    result.current.setPreference('voiceOutputEnabled', true);
  });

  assert.deepEqual(result.current.availability, { canDictate: true, canSpeak: true });
});
