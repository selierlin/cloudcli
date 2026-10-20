#!/usr/bin/env node
/**
 * Mints a bearer token for the local CloudCLI user and writes it to a
 * 0600 file, so an agent-driven browser session can be signed in without a
 * password ever passing through a transcript.
 *
 * The browser MCP runs headless and only knows form/click/key tools, so it
 * cannot type a password the way a human would, and a stored browser profile
 * stops working once the 7-day token expires. `browser_create_session` reads
 * this file by path and seeds `localStorage['auth-token']` before the first
 * navigation — the token string itself never has to be printed.
 *
 * Usage:
 *   node scripts/mint-auth-token.mjs                  # write the default file
 *   node scripts/mint-auth-token.mjs --out <path>     # write elsewhere
 *   node scripts/mint-auth-token.mjs --stdout         # print it (pipes, manual tests)
 */

import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(scriptDirectory, '..');
const DEFAULT_TOKEN_PATH = path.join(os.homedir(), '.cloudcli', 'browser-use', 'auth-token');
// Same lifetime the server signs with (server/modules/auth/auth.middleware.ts).
const TOKEN_TTL = '7d';

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

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

function maskToken(token) {
  return `${token.slice(0, 12)}…${token.slice(-6)}`;
}

async function main() {
  const databasePath = await resolveDatabasePath();
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  let secret;
  let user;
  try {
    secret = database.prepare('SELECT value FROM app_config WHERE key = ?').get('jwt_secret')?.value;
    user = database.prepare('SELECT id, username FROM users WHERE is_active = 1 LIMIT 1').get();
  } finally {
    database.close();
  }

  if (!secret) {
    throw new Error(`No jwt_secret in ${databasePath}. Start CloudCLI once so it creates one.`);
  }
  if (!user) {
    throw new Error(`No active user in ${databasePath}. Complete the setup screen first.`);
  }

  const token = jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: TOKEN_TTL });
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  if (process.argv.includes('--stdout')) {
    console.log(token);
    return;
  }

  const outputPath = path.resolve(readOption('--out') || DEFAULT_TOKEN_PATH);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, token, { mode: 0o600 });
  // writeFile only applies `mode` when it creates the file; keep old copies private too.
  await chmod(outputPath, 0o600);

  console.log(`user:    ${user.username} (id ${user.id})`);
  console.log(`expires: ${expiresAt}`);
  console.log(`token:   ${maskToken(token)}`);
  console.log(`written: ${outputPath}`);
  console.log('Start a browser session with authTokenFile pointing at that path.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
