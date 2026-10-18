#!/usr/bin/env node
/**
 * Fails when a locale JSON file repeats a key inside the same object.
 *
 * `JSON.parse` keeps the last occurrence silently, so a merge that appends a
 * second `"modelLibrary"` block deletes every key of the first one without any
 * error. Read the raw text and track keys per object instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const localesRoot = fileURLToPath(new URL('../src/modules/i18n/locales/', import.meta.url));

/** Returns `{ path, key }` for every key repeated within one object. */
function findDuplicateKeys(text) {
  const duplicates = [];
  const stack = [{ type: 'object', keys: new Set(), path: '', pendingKey: null }];
  let pendingString = null;
  let lastToken = '';

  const skipWhitespace = (index) => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    return index;
  };

  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      let value = '';
      index += 1;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') {
          value += text[index] + (text[index + 1] ?? '');
          index += 2;
          continue;
        }
        value += text[index];
        index += 1;
      }
      index += 1;
      pendingString = value;
      lastToken = 'string';
      continue;
    }

    if (char === ':') {
      const frame = stack.at(-1);
      if (frame.type === 'object' && lastToken === 'string') {
        if (frame.keys.has(pendingString)) {
          duplicates.push({ path: frame.path || '(root)', key: pendingString });
        } else {
          frame.keys.add(pendingString);
        }
        frame.pendingKey = pendingString;
      }
      pendingString = null;
      lastToken = 'colon';
      index += 1;
      continue;
    }

    if (char === '{' || char === '[') {
      const parent = stack.at(-1);
      const key = parent.pendingKey;
      const path = key === null ? parent.path : (parent.path ? `${parent.path}.${key}` : key);
      parent.pendingKey = null;
      stack.push({ type: char === '{' ? 'object' : 'array', keys: new Set(), path, pendingKey: null });
      pendingString = null;
      lastToken = char;
      index += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      stack.pop();
      pendingString = null;
      lastToken = char;
      index += 1;
      continue;
    }

    if (char === ',') {
      const frame = stack.at(-1);
      if (frame) frame.pendingKey = null;
      pendingString = null;
      lastToken = 'comma';
      index += 1;
      continue;
    }

    index = skipWhitespace(index + 1);
  }

  return duplicates;
}

const failures = [];
for (const locale of readdirSync(localesRoot, { withFileTypes: true })) {
  if (!locale.isDirectory()) continue;
  const localeDir = join(localesRoot, locale.name);
  for (const file of readdirSync(localeDir)) {
    if (!file.endsWith('.json')) continue;
    const path = join(localeDir, file);
    const text = readFileSync(path, 'utf8');
    const shownPath = relative(process.cwd(), path);

    try {
      JSON.parse(text);
    } catch (error) {
      failures.push(`${shownPath}: invalid JSON — ${error.message}`);
      continue;
    }

    for (const { path: objectPath, key } of findDuplicateKeys(text)) {
      failures.push(`${shownPath}: duplicate key "${key}" in ${objectPath}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('locale JSON: no duplicate keys');
