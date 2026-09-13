import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import { ZcodeSkillsProvider } from '@/modules/providers/list/zcode/zcode-skills.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

let restoreHomeDir: (() => void) | null = null;
let tempRoot: string | null = null;

async function withIsolatedSkills(runTest: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zcode-skills-test-'));
  restoreHomeDir = patchHomeDir(root);
  tempRoot = root;
  try {
    await runTest(root);
  } finally {
    restoreHomeDir();
    restoreHomeDir = null;
    await rm(root, { recursive: true, force: true });
    tempRoot = null;
  }
}

afterEach(() => {
  if (restoreHomeDir) {
    restoreHomeDir();
    restoreHomeDir = null;
  }
  if (tempRoot) {
    void rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

const skillMd = (name: string, description: string): string => (
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo a thing.\n`
);

test('ZCode discovers skills in ~/.zcode/skills and ~/.agents/skills with the /skill command', async () => {
  await withIsolatedSkills(async (root) => {
    await mkdir(path.join(root, '.zcode', 'skills', 'alpha'), { recursive: true });
    await writeFile(path.join(root, '.zcode', 'skills', 'alpha', 'SKILL.md'), skillMd('alpha', 'Alpha skill'));
    await mkdir(path.join(root, '.agents', 'skills', 'beta'), { recursive: true });
    await writeFile(path.join(root, '.agents', 'skills', 'beta', 'SKILL.md'), skillMd('beta', 'Beta skill'));

    const skills = await new ZcodeSkillsProvider().listSkills({ workspacePath: root });
    assert.deepEqual(skills.map((skill) => skill.command).sort(), ['/skill alpha', '/skill beta']);
  });
});

test('ZCode discovers project-scope skills from the workspace roots', async () => {
  await withIsolatedSkills(async (root) => {
    // The workspace is nested under the home dir but has its own skill root.
    const workspacePath = path.join(root, 'workspace');
    await mkdir(path.join(workspacePath, '.zcode', 'skills', 'gamma'), { recursive: true });
    await writeFile(
      path.join(workspacePath, '.zcode', 'skills', 'gamma', 'SKILL.md'),
      skillMd('gamma', 'Gamma skill'),
    );

    const skills = await new ZcodeSkillsProvider().listSkills({ workspacePath });
    assert.deepEqual(skills.map((skill) => skill.command), ['/skill gamma']);
    assert.equal(skills[0]?.scope, 'repo');
  });
});

test('ZCode skills tolerate missing roots and fall back to the directory name without front matter', async () => {
  await withIsolatedSkills(async (root) => {
    assert.deepEqual(await new ZcodeSkillsProvider().listSkills({ workspacePath: root }), []);

    await mkdir(path.join(root, '.zcode', 'skills', 'broken'), { recursive: true });
    await writeFile(path.join(root, '.zcode', 'skills', 'broken', 'SKILL.md'), '# no front matter\n');
    // The shared reader tolerates missing front matter by naming the skill after
    // its directory, so the file is still discovered rather than dropped.
    const skills = await new ZcodeSkillsProvider().listSkills({ workspacePath: root });
    assert.deepEqual(skills.map((skill) => skill.command), ['/skill broken']);
    assert.equal(skills[0]?.name, 'broken');
    assert.equal(skills[0]?.description, '');
  });
});

test('ZCode skills install and remove round-trips through ~/.zcode/skills', async () => {
  await withIsolatedSkills(async (root) => {
    const provider = new ZcodeSkillsProvider();
    const installed = await provider.addSkills({
      entries: [{ content: skillMd('delta', 'Delta skill'), directoryName: 'delta' }],
    });

    assert.deepEqual(installed.map((skill) => skill.command), ['/skill delta']);
    const written = await readFile(path.join(root, '.zcode', 'skills', 'delta', 'SKILL.md'), 'utf8');
    assert.ok(written.includes('name: delta'));

    const listed = await provider.listSkills({ workspacePath: root });
    assert.deepEqual(listed.map((skill) => skill.command), ['/skill delta']);

    const removed = await provider.removeSkill({ directoryName: 'delta' });
    assert.equal(removed.removed, true);
    assert.deepEqual(await provider.listSkills({ workspacePath: root }), []);
  });
});
