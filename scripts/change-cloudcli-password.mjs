#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const bcrypt = require('bcrypt');
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(scriptDirectory, '..');

async function readDatabasePathFromEnvFile() {
  try {
    const contents = await readFile(path.join(applicationRoot, '.env'), 'utf8');
    const line = contents.split('\n').find((candidate) => candidate.trim().startsWith('DATABASE_PATH='));
    return line ? line.slice(line.indexOf('=') + 1).trim() : null;
  } catch {
    return null;
  }
}

async function resolveDatabasePath() {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }

  const configuredPath = await readDatabasePathFromEnvFile();
  return configuredPath || path.join(os.homedir(), '.cloudcli', 'auth.db');
}

function readSecret(prompt) {
  if (!stdin.isTTY) {
    throw new Error('请在交互式终端中运行此脚本。');
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const restoreTerminal = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          restoreTerminal();
          stdout.write('\n');
          reject(new Error('已取消修改密码。'));
          return;
        }
        if (character === '\r' || character === '\n') {
          restoreTerminal();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
  });
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('请在交互式终端中运行此脚本。');
  }

  const databasePath = await resolveDatabasePath();
  await access(databasePath);

  const prompts = readline.createInterface({ input: stdin, output: stdout });
  const currentUsername = (await prompts.question('当前账号：')).trim();
  const requestedUsername = (await prompts.question('新账号（直接回车表示不修改）：')).trim();
  prompts.close();

  if (!currentUsername) {
    throw new Error('当前账号不能为空。');
  }

  const newUsername = requestedUsername || currentUsername;
  if (newUsername.length < 3) {
    throw new Error('账号至少需要 3 个字符。');
  }

  const newPassword = await readSecret('新密码：');
  const confirmedPassword = await readSecret('再次输入新密码：');
  if (newPassword.length < 6) {
    throw new Error('密码至少需要 6 个字符。');
  }
  if (newPassword !== confirmedPassword) {
    throw new Error('两次输入的密码不一致。');
  }

  const database = new Database(databasePath);
  try {
    const user = database
      .prepare('SELECT id, username FROM users WHERE username = ? AND is_active = 1')
      .get(currentUsername);
    if (!user) {
      throw new Error(`未找到账号“${currentUsername}”。`);
    }

    const usernameConflict = database
      .prepare('SELECT id FROM users WHERE username = ? AND id <> ?')
      .get(newUsername, user.id);
    if (usernameConflict) {
      throw new Error(`账号“${newUsername}”已存在。`);
    }

    const backupPath = `${databasePath}.before-password-change-${Date.now()}.backup`;
    await database.backup(backupPath);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const update = database.prepare(
      'UPDATE users SET username = ?, password_hash = ? WHERE id = ?',
    );
    const transaction = database.transaction(() => update.run(newUsername, passwordHash, user.id));
    const result = transaction();
    if (result.changes !== 1) {
      throw new Error('账号更新失败，数据库未变更。');
    }

    console.log(`修改成功：${newUsername}`);
    console.log(`数据库备份：${backupPath}`);
    console.log('请退出当前登录状态，并使用新账号密码重新登录。');
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(`修改失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
