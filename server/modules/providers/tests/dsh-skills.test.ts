import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';

import { DshSkillsProvider } from '@/modules/providers/list/dsh/dsh-skills.provider.js';

const ENV_KEYS = ['DSH_HOME', 'DSH_AGENTS_HOME'] as const;
type EnvKey = (typeof ENV_KEYS)[number];

let tempRoot: string | null = null;

async function withIsolatedHomes(
  runTest: (context: { root: string; dshHome: string; agentsHome: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-skills-test-'));
  const dshHome = path.join(root, '.dsh');
  const agentsHome = path.join(root, '.agents');
  const previousEnv: Partial<Record<EnvKey, string>> = {};
  for (const key of ENV_KEYS) {
    previousEnv[key] = process.env[key];
  }
  process.env.DSH_HOME = dshHome;
  process.env.DSH_AGENTS_HOME = agentsHome;
  tempRoot = root;

  try {
    await runTest({ root, dshHome, agentsHome });
  } finally {
    for (const key of ENV_KEYS) {
      const previousValue = previousEnv[key];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
    await rm(root, { recursive: true, force: true });
    tempRoot = null;
  }
}

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

const writeSkill = async (skillsRoot: string, name: string): Promise<void> => {
  await mkdir(path.join(skillsRoot, name), { recursive: true });
  await writeFile(
    path.join(skillsRoot, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\nDo a thing.\n`,
    'utf8',
  );
};

test('discovers project and user skills from the DSH default roots', async () => {
  await withIsolatedHomes(async ({ root, dshHome, agentsHome }) => {
    const workspace = path.join(root, 'workspace');
    await mkdir(workspace, { recursive: true });
    await writeSkill(path.join(workspace, '.dsh', 'skills'), 'project-dsh-skill');
    await writeSkill(path.join(workspace, '.agents', 'skills'), 'project-agents-skill');
    await writeSkill(path.join(dshHome, 'skills'), 'user-dsh-skill');
    await writeSkill(path.join(agentsHome, 'skills'), 'user-agents-skill');

    const skills = await new DshSkillsProvider().listSkills({ workspacePath: workspace });
    const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));

    assert.deepEqual([...skillsByName.keys()].sort(), [
      'project-agents-skill',
      'project-dsh-skill',
      'user-agents-skill',
      'user-dsh-skill',
    ]);
    assert.equal(skillsByName.get('project-dsh-skill')?.command, '/project-dsh-skill');
    assert.equal(skillsByName.get('project-dsh-skill')?.scope, 'project');
    assert.equal(skillsByName.get('project-agents-skill')?.command, '/project-agents-skill');
    assert.equal(skillsByName.get('project-agents-skill')?.scope, 'project');
    assert.equal(skillsByName.get('user-dsh-skill')?.command, '/user-dsh-skill');
    assert.equal(skillsByName.get('user-dsh-skill')?.scope, 'user');
    assert.equal(skillsByName.get('user-agents-skill')?.command, '/user-agents-skill');
    assert.equal(skillsByName.get('user-agents-skill')?.scope, 'user');
  });
});

test('anchors project skill roots at the nearest git worktree root', async () => {
  await withIsolatedHomes(async ({ root }) => {
    const outerRoot = path.join(root, 'outer');
    const innerRoot = path.join(outerRoot, 'inner');
    const workspace = path.join(innerRoot, 'packages', 'app');
    await mkdir(path.join(outerRoot, '.git'), { recursive: true });
    await mkdir(path.join(innerRoot, '.git'), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeSkill(path.join(outerRoot, '.agents', 'skills'), 'outer-skill');
    await writeSkill(path.join(innerRoot, '.agents', 'skills'), 'inner-skill');

    const skills = await new DshSkillsProvider().listSkills({ workspacePath: workspace });
    // DSH stops at the nearest worktree root, so the enclosing repo's skills
    // stay invisible even though the workspace sits inside it.
    assert.deepEqual(skills.map((skill) => skill.name), ['inner-skill']);
  });
});

test('falls back to the workspace itself when no git root encloses it', async () => {
  await withIsolatedHomes(async ({ root }) => {
    const workspace = path.join(root, 'plain');
    await mkdir(workspace, { recursive: true });
    await writeSkill(path.join(workspace, '.agents', 'skills'), 'workspace-skill');

    const skills = await new DshSkillsProvider().listSkills({ workspacePath: workspace });
    assert.deepEqual(skills.map((skill) => skill.command), ['/workspace-skill']);
  });
});

test('keeps skill writes unsupported because the harness owns loading', async () => {
  const provider = new DshSkillsProvider();

  await assert.rejects(
    () => provider.addSkills({ entries: [{ content: '---\nname: x\n---\n' }] }),
    /does not support managed global skills/,
  );
  await assert.rejects(
    () => provider.removeSkill({ directoryName: 'x' }),
    /does not support managed global skills/,
  );
});
