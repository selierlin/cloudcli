import assert from 'node:assert/strict';

import { afterEach, beforeEach, describe, it, vi } from 'vitest';

/**
 * The tab icon is the only attention channel a favicon-only tab has, so the marks
 * below are the whole signal: green check for a finished run, amber mark for one
 * blocked on an approval, red cross for a failed one. The tests pin the priority
 * between them and the clock each clears on, because both are invisible until the
 * wrong mark is showing.
 */

const COMPLETE_HREF = '/icons/favicon-complete-32.png';
const FAILED_HREF = '/icons/favicon-failed-32.png';
const APPROVAL_HREF = '/icons/favicon-approval-32.png';
const LIGHT_HREF = '/icons/favicon-light-32.png';
const DARK_HREF = '/icons/favicon-dark-32.png';

let visibility: DocumentVisibilityState = 'visible';
let focused = true;

function faviconHref(): string | null {
  return document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null;
}

function raisedMark(): string | null {
  return document.documentElement.getAttribute('data-tab-attention');
}

function setPageState(next: DocumentVisibilityState, hasFocus: boolean): void {
  visibility = next;
  focused = hasFocus;
}

async function loadIndicator() {
  vi.resetModules();
  return import('@/shared/favicon');
}

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '<link rel="icon" type="image/png" href="/icons/favicon-light-32.png" />';
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-tab-attention');
  document.title = '修复登录流程';
  setPageState('visible', true);

  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(document, 'hasFocus', {
    configurable: true,
    value: () => focused,
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(document, 'hasFocus');
  document.body.innerHTML = '';
});

describe('listener hygiene', () => {
  it('detaches the countdown hold with the mark instead of stacking one per raise', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { showCompletionIndicator } = await loadIndicator();

    showCompletionIndicator();
    vi.advanceTimersByTime(2000);
    showCompletionIndicator();
    vi.advanceTimersByTime(2000);

    const count = (calls: unknown[][]): number =>
      calls.filter(([type]) => type === 'visibilitychange').length;

    // Every countdown attaches its hold listener once. Without the paired
    // detach, a long session leaves one behind per finished run, and the
    // survivor later attaches return listeners nobody removes.
    assert.equal(count(add.mock.calls), 2);
    assert.equal(count(remove.mock.calls), 2);
  });
});

describe('completion mark', () => {
  it('blinks the green favicon while raised and clears it after two seconds', async () => {
    const { showCompletionIndicator } = await loadIndicator();

    showCompletionIndicator();

    assert.equal(faviconHref(), COMPLETE_HREF);
    assert.equal(raisedMark(), 'completion');
    assert.equal(document.title, '修复登录流程');

    vi.advanceTimersByTime(600);
    assert.equal(faviconHref(), LIGHT_HREF, 'the mark blinks off between phases');

    vi.advanceTimersByTime(600);
    assert.equal(faviconHref(), COMPLETE_HREF, 'the mark comes back on the next phase');

    vi.advanceTimersByTime(800);
    assert.equal(faviconHref(), LIGHT_HREF);
    assert.equal(raisedMark(), null);
    assert.equal(document.title, '修复登录流程');

    // The blink must stop with the mark, not keep toggling the restored icon.
    vi.advanceTimersByTime(5000);
    assert.equal(faviconHref(), LIGHT_HREF);
  });

  it('restarts the blink from the visible phase when a second run finishes', async () => {
    const { showCompletionIndicator } = await loadIndicator();

    showCompletionIndicator();
    vi.advanceTimersByTime(600);
    assert.equal(faviconHref(), LIGHT_HREF);

    showCompletionIndicator();

    assert.equal(faviconHref(), COMPLETE_HREF, 'a fresh completion is not hidden behind the old off-phase');
  });

  it('holds the mark while the tab is hidden and clears it shortly after the user returns', async () => {
    const { showCompletionIndicator } = await loadIndicator();

    setPageState('hidden', false);
    showCompletionIndicator();

    vi.advanceTimersByTime(60_000);
    assert.equal(raisedMark(), 'completion', 'a background completion keeps the mark indefinitely');

    setPageState('visible', true);
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(2000);

    assert.equal(faviconHref(), LIGHT_HREF);
    assert.equal(raisedMark(), null);
  });

  it('restores the dark render when the page wears the dark appearance', async () => {
    const { showCompletionIndicator } = await loadIndicator();

    document.documentElement.classList.add('dark');
    showCompletionIndicator();
    assert.equal(faviconHref(), COMPLETE_HREF);

    vi.advanceTimersByTime(2000);
    assert.equal(faviconHref(), DARK_HREF);
  });

  it('keeps the mark when the appearance is republished mid-indicator', async () => {
    const { showCompletionIndicator } = await loadIndicator();
    const { applyThemeChrome } = await import('@/shared/utils');

    setPageState('hidden', false);
    showCompletionIndicator();

    applyThemeChrome('dark');

    assert.equal(faviconHref(), COMPLETE_HREF, 'a theme switch must not erase the finished signal');
    assert.equal(raisedMark(), 'completion');
  });
});

describe('failure mark', () => {
  it('shows a steady red cross and clears it after two seconds', async () => {
    const { showFailureIndicator } = await loadIndicator();

    showFailureIndicator();

    assert.equal(faviconHref(), FAILED_HREF);
    assert.equal(raisedMark(), 'failure');

    vi.advanceTimersByTime(1200);
    assert.equal(faviconHref(), FAILED_HREF, 'a failure does not blink');

    vi.advanceTimersByTime(800);
    assert.equal(faviconHref(), LIGHT_HREF);
    assert.equal(raisedMark(), null);
  });

  it('outranks a completion raised earlier', async () => {
    const { showCompletionIndicator, showFailureIndicator } = await loadIndicator();

    setPageState('hidden', false);
    showCompletionIndicator();
    showFailureIndicator();

    assert.equal(faviconHref(), FAILED_HREF);
    assert.equal(raisedMark(), 'failure');
  });
});

describe('approval mark', () => {
  it('holds an amber mark at a slower blink until the approvals empty', async () => {
    const { setApprovalIndicator } = await loadIndicator();

    setApprovalIndicator(true);

    assert.equal(faviconHref(), APPROVAL_HREF);
    assert.equal(raisedMark(), 'approval');

    // Half of the approval phase: the mark is still on, unlike the completion blink.
    vi.advanceTimersByTime(600);
    assert.equal(faviconHref(), APPROVAL_HREF);

    vi.advanceTimersByTime(600);
    assert.equal(faviconHref(), LIGHT_HREF, 'the slower phase turns the mark off');

    vi.advanceTimersByTime(60_000);
    assert.equal(raisedMark(), 'approval', 'a blocked run never clears itself on a timer');

    setApprovalIndicator(false);

    assert.equal(faviconHref(), LIGHT_HREF);
    assert.equal(raisedMark(), null);
  });

  it('outranks a completion and lets it show again once the approvals empty', async () => {
    const { showCompletionIndicator, setApprovalIndicator } = await loadIndicator();

    setPageState('hidden', false);
    showCompletionIndicator();
    setApprovalIndicator(true);

    assert.equal(faviconHref(), APPROVAL_HREF);
    assert.equal(raisedMark(), 'approval');

    vi.advanceTimersByTime(60_000);
    setApprovalIndicator(false);

    assert.equal(faviconHref(), COMPLETE_HREF, 'the finished run is still waiting to be seen');
    assert.equal(raisedMark(), 'completion');

    setPageState('visible', true);
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(2000);

    assert.equal(faviconHref(), LIGHT_HREF);
    assert.equal(raisedMark(), null);
  });

  it('keeps the mark when the appearance is republished mid-blink', async () => {
    const { setApprovalIndicator } = await loadIndicator();
    const { applyThemeChrome } = await import('@/shared/utils');

    setApprovalIndicator(true);
    applyThemeChrome('dark');

    assert.equal(faviconHref(), APPROVAL_HREF);
    assert.equal(raisedMark(), 'approval');
  });
});
