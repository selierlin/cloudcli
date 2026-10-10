import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import { setOpenclawHomeDirForTests } from '@/modules/providers/list/openclaw/openclaw-models.provider.js';
import { OpenclawSkillsProvider } from '@/modules/providers/list/openclaw/openclaw-skills.provider.js';

let homeDir: string | null = null;

beforeEach(() => {
  setOpenclawHomeDirForTests(null);
});

afterEach(async () => {
  setOpenclawHomeDirForTests(null);
  if (homeDir) {
    const dir = homeDir;
    homeDir = null;
    await rm(dir, { recursive: true, force: true });
  }
});

async function withStateRoot(
  runTest: (env: { homeDir: string; workspace: string }) => Promise<void>,
): Promise<void> {
  homeDir = await mkdtemp(path.join(os.tmpdir(), 'openclaw-skills-'));
  setOpenclawHomeDirForTests(homeDir);
  const workspace = path.join(homeDir, 'workspace', 'proj');
  await mkdir(workspace, { recursive: true });
  await runTest({ homeDir, workspace });
}

const skillMd = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo a thing.\n`;

const writeSkill = async (rootDir: string, name: string): Promise<void> => {
  await mkdir(path.join(rootDir, name), { recursive: true });
  await writeFile(path.join(rootDir, name, 'SKILL.md'), skillMd(name, `${name} skill`));
};

test('discovers managed, plugin and project skills with the /name command', async () => {
  await withStateRoot(async ({ homeDir: stateRoot, workspace }) => {
    await writeSkill(path.join(stateRoot, 'skills'), 'alpha');
    await writeSkill(path.join(stateRoot, 'plugin-skills'), 'plugin-beta');
    await writeSkill(path.join(workspace, '.openclaw', 'skills'), 'proj-gamma');

    const skills = await new OpenclawSkillsProvider().listSkills({ workspacePath: workspace });
    const commands = skills.map((skill) => skill.command).sort();
    assert.deepEqual(commands, ['/alpha', '/plugin-beta', '/proj-gamma']);
  });
});

test('marks the managed skill root as a user scope and the project root as project scope', async () => {
  await withStateRoot(async ({ homeDir: stateRoot, workspace }) => {
    await writeSkill(path.join(stateRoot, 'skills'), 'alpha');
    await writeSkill(path.join(workspace, '.openclaw', 'skills'), 'proj');

    const skills = await new OpenclawSkillsProvider().listSkills({ workspacePath: workspace });
    const byCommand = new Map(skills.map((skill) => [skill.command, skill.scope]));
    assert.equal(byCommand.get('/alpha'), 'user');
    assert.equal(byCommand.get('/proj'), 'project');
  });
});

test('returns no skills when no skill directory exists', async () => {
  await withStateRoot(async ({ workspace }) => {
    const skills = await new OpenclawSkillsProvider().listSkills({ workspacePath: workspace });
    assert.deepEqual(skills, []);
  });
});
