import assert from 'node:assert/strict';

import { afterEach, beforeEach, test } from 'vitest';

import { synthesizeVoice, transcribeVoice } from '@/shared/api';
import { VOICE_CONFIG_STORAGE_KEY } from '@/shared/voiceConfig';

/**
 * MiMo's audio API is chat-shaped (`POST /chat/completions`) rather than the
 * OpenAI audio endpoints this module otherwise targets, and it only accepts
 * wav/mp3 input. These tests pin the MiMo branch: it must address the chat
 * endpoint with the right body, transcode recordings to wav, unwrap the base64
 * audio on the speech path, and leave the plain OpenAI path untouched.
 */

const MIMO_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';

const configure = (config: Record<string, unknown>) => {
  localStorage.setItem(
    VOICE_CONFIG_STORAGE_KEY,
    JSON.stringify({ baseUrl: MIMO_BASE_URL, ...config }),
  );
};

type Captured = { url: string; init: RequestInit };

// jsdom's Blob has no arrayBuffer(); the MiMo path only reads that member, so a
// blob-shaped stand-in is enough.
const recording = (bytes: number[], type = 'audio/webm;codecs=opus'): Blob =>
  ({ arrayBuffer: async () => new Uint8Array(bytes).buffer, type }) as unknown as Blob;

const stubFetch = (responder: () => Response): Captured[] => {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const captured: Captured = { url: String(input), init: init ?? {} };
    calls.push(captured);
    return responder();
  }) as typeof fetch;
  return calls;
};

// Minimal Web Audio stand-in: decodeAudioData returns fixed PCM so the wav
// encoder can run without a real browser audio stack.
class FakeAudioContext {
  async decodeAudioData() {
    return {
      numberOfChannels: 1,
      sampleRate: 16_000,
      getChannelData: () => new Float32Array([0, 0.5, -0.5, 1]),
    };
  }

  close() {}
}

const originalFetch = globalThis.fetch;
const originalAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;

beforeEach(() => {
  localStorage.clear();
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { AudioContext?: unknown }).AudioContext = originalAudioContext;
});

test('MiMo TTS posts to the chat endpoint and unwraps the base64 audio', async () => {
  configure({ apiKey: 'secret' });
  const bytes = Uint8Array.from([0xff, 0xf3, 0x01, 0x02]);
  const encoded = btoa(String.fromCharCode(...bytes));
  const calls = stubFetch(
    () =>
      new Response(JSON.stringify({ choices: [{ message: { audio: { data: encoded } } }] }), {
        status: 200,
      }),
  );

  const response = await synthesizeVoice('read this', new AbortController().signal);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${MIMO_BASE_URL}/chat/completions`);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'mimo-v2.5-tts');
  assert.deepEqual(body.messages, [{ role: 'assistant', content: 'read this' }]);
  assert.deepEqual(body.audio, { format: 'mp3', voice: 'mimo_default' });
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer secret');

  assert.equal(response.ok, true);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...bytes]);
});

test('MiMo STT transcodes the recording to wav and reads the transcript', async () => {
  configure({});
  const calls = stubFetch(
    () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'hello world' } }] }), {
        status: 200,
      }),
  );

  const response = await transcribeVoice(recording([1, 2, 3]), 'recording.webm');

  assert.equal(calls[0].url, `${MIMO_BASE_URL}/chat/completions`);
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, 'mimo-v2.5-asr');
  const part = body.messages[0].content[0];
  assert.equal(part.type, 'input_audio');
  assert.ok(
    part.input_audio.data.startsWith('data:audio/wav;base64,'),
    'recording must be uploaded as wav',
  );

  assert.deepEqual(await response.json(), { text: 'hello world' });
});

test('MiMo TTS surfaces a backend error instead of an empty audio blob', async () => {
  configure({});
  stubFetch(() => new Response('{"error":"bad"}', { status: 401 }));

  const response = await synthesizeVoice('hi', new AbortController().signal);

  assert.equal(response.status, 401);
});

test('a non-MiMo base URL still uses the OpenAI audio endpoints', async () => {
  configure({ baseUrl: 'https://api.openai.com/v1' });
  const calls = stubFetch(() => new Response('{"text":"ok"}', { status: 200 }));

  await transcribeVoice(new Blob([new Uint8Array([1])], { type: 'audio/webm' }), 'r.webm');

  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
});
