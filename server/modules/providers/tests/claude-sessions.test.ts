import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

import { sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';

const SESSION_ID = 'session-1';

const SKILL_BODY = [
  'Base directory for this skill: /tmp/claude/bundled-skills/2.1.220/abc123/claude-api',
  '',
  '# Building LLM-Powered Applications with Claude',
  '',
  'This skill helps you build LLM-powered applications with Claude.',
].join('\n');

test('claude: injected skill bodies are hidden even without the isMeta flag', () => {
  const provider = new ClaudeSessionsProvider();

  // The live SDK stream omits `isMeta`, so the payload has to be recognised by
  // its content or it renders as a giant user bubble mid-run.
  const live = provider.normalizeMessage(
    {
      uuid: 'u1',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(live, []);

  const persisted = provider.normalizeMessage(
    {
      uuid: 'u2',
      timestamp: '2026-07-28T10:00:00.000Z',
      isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(persisted, []);
});

test('claude: the Skill tool result itself still reaches the UI', () => {
  const provider = new ClaudeSessionsProvider();

  const messages = provider.normalizeMessage(
    {
      uuid: 'u3',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill: claude-api' }],
      },
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].toolId, 'toolu_1');
});

test('claude history embeds a paired tool result once before pagination', { concurrency: false }, async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'claude-history-tool-result-'));
  const transcriptPath = path.join(tempDirectory, 'session.jsonl');
  const providerSessionId = 'claude-native-history-1';

  await writeFile(transcriptPath, [
    {
      type: 'assistant',
      sessionId: providerSessionId,
      uuid: 'assistant-1',
      timestamp: '2026-08-29T01:00:00.000Z',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Bash',
          input: { command: 'npm test' },
        }],
      },
    },
    {
      type: 'user',
      sessionId: providerSessionId,
      uuid: 'user-1',
      timestamp: '2026-08-29T01:00:01.000Z',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'all tests passed',
        }],
      },
    },
  ].map((entry) => JSON.stringify(entry)).join('\n'));

  mock.method(sessionsDb, 'getSessionById', () => ({
    session_id: 'app-claude-history-1',
    provider_session_id: providerSessionId,
    provider: 'claude',
    project_path: tempDirectory,
    jsonl_path: transcriptPath,
    custom_name: null,
    model: null,
    effort: null,
    isArchived: 0,
    created_at: '2026-08-29T01:00:00.000Z',
    updated_at: '2026-08-29T01:00:01.000Z',
  }));
  t.after(async () => {
    mock.reset();
    await rm(tempDirectory, { recursive: true, force: true });
  });

  const history = await new ClaudeSessionsProvider().fetchHistory('app-claude-history-1', {
    providerSessionId,
  });

  assert.equal(history.total, 1);
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0]?.kind, 'tool_use');
  assert.deepEqual(history.messages[0]?.toolResult, {
    content: 'all tests passed',
    isError: false,
    toolUseResult: undefined,
  });
  assert.equal(history.messages.some((message) => message.kind === 'tool_result'), false);
});
