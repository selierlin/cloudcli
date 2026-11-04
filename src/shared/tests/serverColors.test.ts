import { describe, expect, it } from 'vitest';

import type { SavedServer } from '@/shared/types';
import { getServerColor, getServerColors } from '@/shared/utils';

/**
 * Colours are the only server cue that survives a glance, so two saved servers
 * must never share one, and the same list must always derive the same colours
 * — every WebView computes them independently from the stored list.
 */

const server = (url: string, name = url): SavedServer => ({ name, url });

const list = (count: number): SavedServer[] =>
  Array.from({ length: count }, (_, index) => server(`https://server-${index}.example`));

describe('getServerColors', () => {
  it('derives the same colours for the same list', () => {
    const servers = list(3);

    expect(getServerColors(servers)).toEqual(getServerColors(list(3)));
  });

  it('never repeats a colour within the palette range', () => {
    const colors = getServerColors(list(8));

    expect(colors).toHaveLength(8);
    expect(new Set(colors).size).toBe(8);
  });

  it('keeps going past the palette size instead of looping forever', () => {
    const colors = getServerColors(list(10));

    expect(colors).toHaveLength(10);
    expect(colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
  });

  it('returns an empty list for no servers', () => {
    expect(getServerColors([])).toEqual([]);
  });
});

describe('getServerColor', () => {
  it('matches the entry by origin, ignoring a stored path or trailing slash', () => {
    const servers = [server('https://a.example/'), server('https://b.example/app')];

    expect(getServerColor(servers, 'https://b.example')).toBe(getServerColors(servers)[1]);
  });

  it('returns undefined for an address that was never saved', () => {
    expect(getServerColor(list(2), 'https://hand-typed.example')).toBeUndefined();
  });
});
