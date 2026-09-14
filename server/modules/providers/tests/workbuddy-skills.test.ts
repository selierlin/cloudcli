import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import { WorkbuddySkillsProvider } from '@/modules/providers/list/workbuddy/workbuddy-skills.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

// The workbuddy user skill root follows `resolveWorkbuddyConfigDir`, which
// honors explicit config-dir overrides before the `~/.workbuddy` default.
const patchConfigDirEnv = (): (() => void) => {
  const originalCodebuddy = process.env.CODEBUDDY_CONFIG_DIR;
  const originalWorkbuddy = process.env.WORKBUDDY_CONFIG_DIR;
  delete process.env.CODEBUDDY_CONFIG_DIR;
  delete process.env.WORKBUDDY_CONFIG_DIR;
  return () => {
    if (originalCodebuddy === undefined) {
      delete process.env.CODEBUDDY_CONFIG_DIR;
    } else {
      process.env.CODEBUDDY_CONFIG_DIR = originalCodebuddy;
    }
    if (originalWorkbuddy === undefined) {
      delete process.env.WORKBUDDY_CONFIG_DIR;
    } else {
      process.env.WORKBUDDY_CONFIG_DIR = originalWorkbuddy;
    }
  };
};

let restoreHomeDir: (() => void) | null = null;
let restoreEnv: (() => void) | null = null;
let tempRoot: string | null = null;

async function withIsolatedSkills(runTest: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbuddy-skills-test-'));
  restoreHomeDir = patchHomeDir(root);
  restoreEnv = patchConfigDirEnv();
  tempRoot = root;
  try {
    await runTest(root);
  } finally {
    restoreHomeDir();
    restoreHomeDir = null;
    restoreEnv();
    restoreEnv = null;
    await rm(root, { recursive: true, force: true });
    tempRoot = null;
  }
}

afterEach(() => {
  if (restoreHomeDir) {
    restoreHomeDir();
    restoreHomeDir = null;
  }
  if (restoreEnv) {
    restoreEnv();
    restoreEnv = null;
  }
  if (tempRoot) {
    void rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

const skillMd = (name: string, description: string): string => (
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo a thing.\n`
);

test('WorkBuddy discovers project-level skills under <workspace>/.codebuddy/skills', async () => {
  await withIsolatedSkills(async (root) => {
    const workspacePath = path.join(root, 'workspace');
    await mkdir(path.join(workspacePath, '.codebuddy', 'skills', 'alpha'), { recursive: true });
    await writeFile(
      path.join(workspacePath, '.codebuddy', 'skills', 'alpha', 'SKILL.md'),
      skillMd('alpha', 'Alpha skill'),
    );

    const skills = await new WorkbuddySkillsProvider().listSkills({ workspacePath });
    const alpha = skills.find((skill) => skill.name === 'alpha');
    assert.ok(alpha, 'project-level skill should be discovered');
    assert.equal(alpha?.scope, 'project');
    assert.equal(alpha?.command, '/alpha');
    assert.ok(
      alpha?.sourcePath?.endsWith(path.join('.codebuddy', 'skills', 'alpha', 'SKILL.md')),
    );
  });
});

test('WorkBuddy discovers user-level skills under the config-dir skills root', async () => {
  await withIsolatedSkills(async (root) => {
    await mkdir(path.join(root, '.workbuddy', 'skills', 'beta'), { recursive: true });
    await writeFile(
      path.join(root, '.workbuddy', 'skills', 'beta', 'SKILL.md'),
      skillMd('beta', 'Beta skill'),
    );

    const skills = await new WorkbuddySkillsProvider().listSkills({
      workspacePath: path.join(root, 'workspace'),
    });
    const beta = skills.find((skill) => skill.name === 'beta');
    assert.ok(beta, 'user-level skill should be discovered');
    assert.equal(beta?.scope, 'user');
    assert.equal(beta?.command, '/beta');
  });
});

test('WorkBuddy skills tolerate missing roots', async () => {
  await withIsolatedSkills(async (root) => {
    assert.deepEqual(
      await new WorkbuddySkillsProvider().listSkills({ workspacePath: path.join(root, 'workspace') }),
      [],
    );
  });
});
