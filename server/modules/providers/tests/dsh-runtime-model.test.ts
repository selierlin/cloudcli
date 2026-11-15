import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { dshRuntime, resetDshRuntimeForTests } from '@/modules/providers/list/dsh/dsh-runtime.provider.js';
import { createNormalizedMessage } from '@/shared/utils.js';
import type { ProviderModelsDefinition, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

type CapturedMessage = Record<string, any>;

/**
 * Minimal DSH ACP server advertising two model choices, one of which declares
 * reasoning levels. It records every `session/set_config_option` value and
 * echoes the value that was active when the prompt arrived, so the test proves
 * the model reached the harness before the turn rather than merely being sent
 * somewhere.
 *
 * Mirrors DSH: `reasoning_effort` is only advertised while the active model
 * declares levels, and switching models drops the previously selected level.
 */
const fakeModelDshServer = `
  const MODELS = [
    {
      group: 'volcano-ark',
      name: 'Volcano Ark',
      options: [{ value: JSON.stringify(['volcano-ark', 'glm-5.3-flash']), name: 'GLM 5.3 Flash' }],
    },
    {
      group: 'workbuddy',
      name: 'WorkBuddy',
      options: [{ value: JSON.stringify(['workbuddy', 'deepseek-v4.1-flash']), name: 'DeepSeek V4.1 Flash' }],
    },
  ];
  const EFFORTS = {
    [JSON.stringify(['volcano-ark', 'glm-5.3-flash'])]: [],
    [JSON.stringify(['workbuddy', 'deepseek-v4.1-flash'])]: ['low', 'high'],
  };

  let activeModel = JSON.stringify(['volcano-ark', 'glm-5.3-flash']);
  let activeEffort = '';

  const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
  const configOptions = () => {
    const options = [{
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: activeModel,
      options: MODELS,
    }];
    const levels = EFFORTS[activeModel] ?? [];
    if (levels.length > 0) {
      options.push({
        id: 'reasoning_effort',
        name: 'Reasoning effort',
        category: 'model',
        type: 'select',
        currentValue: activeEffort,
        options: levels.map((level) => ({ value: level, name: level })),
      });
    }
    return options;
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    for (const line of chunk.split('\\n')) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
      } else if (message.method === 'session/new') {
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { sessionId: 'acp-session', configOptions: configOptions() },
        });
      } else if (message.method === 'session/set_config_option') {
        if (message.params.configId === 'model') {
          activeModel = message.params.value;
          activeEffort = '';
        }
        if (message.params.configId === 'reasoning_effort') {
          activeEffort = message.params.value;
        }
        send({ jsonrpc: '2.0', id: message.id, result: { configOptions: configOptions() } });
      } else if (message.method === 'session/prompt') {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session',
            update: {
              sessionUpdate: 'agent_message_chunk',
              messageId: 'msg-1',
              content: { type: 'text', text: 'model:' + activeModel },
            },
          },
        });
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'acp-session',
            update: {
              sessionUpdate: 'agent_message_chunk',
              messageId: 'msg-2',
              content: { type: 'text', text: 'effort:' + (activeEffort || 'unset') + '@' + activeModel },
            },
          },
        });
        send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      }
    }
  });
`;

const createFakeDshBinary = (directory: string): string => {
  const serverPath = path.join(directory, 'fake-dsh-model-server.mjs');
  const binaryPath = path.join(directory, 'dsh');
  fs.writeFileSync(serverPath, fakeModelDshServer, 'utf8');
  fs.writeFileSync(binaryPath, `#!/bin/sh\nexec "${process.execPath}" "${serverPath}"\n`, { mode: 0o755 });
  return binaryPath;
};

const createContext = (
  models: ProviderModelsDefinition = { OPTIONS: [], DEFAULT: 'model' },
): ProviderRuntimeContext => ({
  resolveProviderSessionId: () => null,
  resolveProviderConfigDir: () => null,
  resolveSettingsFile: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => models,
  normalizeMessage: (raw, sessionId) => {
    const event = raw as { content?: string };
    return [createNormalizedMessage({
      kind: 'text',
      role: 'assistant',
      content: event.content ?? '',
      sessionId,
      provider: 'dsh',
    })];
  },
  async isProviderInstalled() {
    return true;
  },
});

const createWriter = (messages: CapturedMessage[]): ProviderRuntimeWriter => ({
  userId: null,
  send: (message) => {
    messages.push(message as CapturedMessage);
  },
});

const withFakeDsh = (t: TestContext): string => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-dsh-model-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const originalPath = process.env.PATH;
  const originalDshHome = process.env.DSH_HOME;
  createFakeDshBinary(temporaryDirectory);
  process.env.PATH = `${temporaryDirectory}${path.delimiter}${originalPath ?? ''}`;
  process.env.DSH_HOME = temporaryDirectory;
  t.after(() => {
    process.env.PATH = originalPath;
    process.env.DSH_HOME = originalDshHome;
  });
  return temporaryDirectory;
};

test.beforeEach(() => {
  resetDshRuntimeForTests();
});

test.afterEach(() => {
  resetDshRuntimeForTests();
});

test('applies the CloudCLI-selected model to the ACP session before prompting', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  const messages: CapturedMessage[] = [];

  await dshRuntime.run(
    'hello',
    { sessionId: 'app-session', cwd: temporaryDirectory, model: 'workbuddy/deepseek-v4.1-flash' },
    createWriter(messages),
    createContext(),
  );

  const reply = messages.find((message) => message.content?.startsWith('model:'));
  assert.equal(
    reply?.content,
    `model:${JSON.stringify(['workbuddy', 'deepseek-v4.1-flash'])}`,
    'the prompt must run after the selected model was applied',
  );
  assert.ok(messages.some((message) => message.kind === 'complete' && message.success === true));
});

const REASONING_MODEL = 'workbuddy/deepseek-v4.1-flash';

test('applies the default effort when the picker is left on Default', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  const messages: CapturedMessage[] = [];

  await dshRuntime.run(
    'hello',
    { sessionId: 'app-session', cwd: temporaryDirectory, model: REASONING_MODEL, effort: 'default' },
    createWriter(messages),
    createContext(),
  );

  const effort = messages.find((message) => message.content?.startsWith('effort:'));
  assert.equal(
    effort?.content,
    `effort:high@${JSON.stringify(['workbuddy', 'deepseek-v4.1-flash'])}`,
    'Default must enable reasoning instead of leaving the harness without a level',
  );
});

test('forwards an explicit effort and never sends a level the model lacks', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  const messages: CapturedMessage[] = [];

  for (const [index, requested] of ['low', 'max'].entries()) {
    messages.length = 0;
    await dshRuntime.run(
      'hello',
      { sessionId: `app-session-${index}`, cwd: temporaryDirectory, model: REASONING_MODEL, effort: requested },
      createWriter(messages),
      createContext(),
    );
    const effort = messages.find((message) => message.content?.startsWith('effort:'));
    // `max` is not advertised by the live harness, so it falls back to the
    // default rather than reaching it (which rejects unknown levels).
    assert.equal(effort?.content?.split('@')[0], requested === 'low' ? 'effort:low' : 'effort:high');
  }
});

test('leaves the effort untouched for a model that declares no levels', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  const messages: CapturedMessage[] = [];

  await dshRuntime.run(
    'hello',
    { sessionId: 'app-session', cwd: temporaryDirectory, model: 'volcano-ark/glm-5.3-flash', effort: 'high' },
    createWriter(messages),
    createContext(),
  );

  const effort = messages.find((message) => message.content?.startsWith('effort:'));
  assert.equal(effort?.content?.split('@')[0], 'effort:unset');
});

test('fails the turn when the selected model is not advertised by the harness', async (t) => {
  const temporaryDirectory = withFakeDsh(t);
  const messages: CapturedMessage[] = [];

  await dshRuntime.run(
    'hello',
    { sessionId: 'app-session', cwd: temporaryDirectory, model: 'wuanai/not-a-model' },
    createWriter(messages),
    createContext(),
  );

  const error = messages.find((message) => message.kind === 'error');
  assert.match(String(error?.content), /does not offer a model matching "wuanai\/not-a-model"/);
  assert.equal(
    messages.some((message) => message.content?.startsWith('model:')),
    false,
    'the turn must not reach the harness when the model cannot be applied',
  );
  assert.ok(messages.some((message) => message.kind === 'complete' && message.success === false));
});
