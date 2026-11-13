import { afterEach, describe, expect, it } from 'vitest';

import {
  buildScrollDiagnosticsReport,
  noteScrollWrite,
  startScrollDiagnostics,
  stopScrollDiagnostics,
} from '@/shared/debug/scrollDiagnostics';

/**
 * The recorder's whole value is that its counters mean what their names say. A
 * report once shipped `rowHeightChanges: 0` while the tracked row tripled in
 * height in the same sample, because the baseline was cleared on every re-pick;
 * and it pooled inertia with app writes under one "jump while touching" number.
 * These cases pin both readings down.
 */

const ROW_TIMESTAMP = '2026-11-10T16:08:24.932Z';

/** Builds the scroll container the sampler expects: a row keyed by timestamp. */
function mountPane(height: number): { pane: HTMLElement; row: HTMLElement } {
  const pane = document.createElement('div');
  pane.style.overflow = 'auto';
  Object.defineProperty(pane, 'clientHeight', { value: 400, configurable: true });
  document.body.appendChild(pane);

  // jsdom lays nothing out, so the two reads the sampler depends on are stubbed.
  Object.defineProperty(pane, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: 0, bottom: 400, left: 0, right: 320, width: 320, height: 400, x: 0, y: 0, toJSON: () => ({}),
    }),
  });

  return { pane, row: mountRowAt(pane, height) };
}

/** Adds one row wrapper carrying the tracked timestamp, sized by the caller. */
function mountRowAt(pane: HTMLElement, height: number): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('data-message-timestamp', ROW_TIMESTAMP);
  row.textContent = 'message';
  // jsdom reports every rect as zero, so the sampler's reads are stubbed here.
  Object.defineProperty(row, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top: 0, bottom: height, left: 0, right: 320, width: 320, height, x: 0, y: 0, toJSON: () => ({}),
    }),
  });
  pane.appendChild(row);
  return row;
}

/** Advances one animation frame so the sampler runs once with current DOM state. */
function runFrame(): void {
  frameCallbacks.splice(0).forEach((callback) => callback(performance.now()));
}

let frameCallbacks: FrameRequestCallback[] = [];
const originalRaf = window.requestAnimationFrame;
const originalCaf = window.cancelAnimationFrame;

function patchAnimationFrames(): void {
  frameCallbacks = [];
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  };
  window.cancelAnimationFrame = () => {};
}

afterEach(() => {
  stopScrollDiagnostics();
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCaf;
  document.body.innerHTML = '';
});

describe('scroll diagnostics sampler', () => {
  it('reports a row height change on the frame that re-picks the row', () => {
    patchAnimationFrames();
    let height = 98;
    const { pane } = mountPane(height);
    startScrollDiagnostics(pane);
    runFrame();

    // The row is replaced by a fresh wrapper, as a lazy remount produces: the
    // tracked element disconnects and the same message comes back much taller.
    const stale = pane.querySelector<HTMLElement>('[data-message-timestamp]')!;
    stale.remove();
    height = 2541;
    mountRowAt(pane, height);

    runFrame();

    const report = buildScrollDiagnosticsReport();
    const heightEvents = (report?.events ?? []).filter((event) => event[1] === 'RH');
    expect(heightEvents).toHaveLength(1);
    // [at, 'RH', id, from, to, trackedTop, wrote, gesture]
    expect(heightEvents[0][3]).toBe(98);
    expect(heightEvents[0][4]).toBe(2541);
    expect(report?.summary.rowHeightChanges).toBe(1);
  });

  it('separates app-written moves from the platform coasting under a finger', () => {
    patchAnimationFrames();
    const { pane } = mountPane(98);
    startScrollDiagnostics(pane);
    runFrame();

    // Frame 1: pure inertia. Nothing in the app wrote scrollTop.
    pane.scrollTop = 40;
    pane.dispatchEvent(new Event('touchstart'));
    runFrame();

    // Frame 2: the app writes while the finger is still down.
    pane.scrollTop = 120;
    noteScrollWrite('restoreAnchor', pane);
    runFrame();

    stopScrollDiagnostics();
    const report = buildScrollDiagnosticsReport();
    // Both frames grew scrollTop by more than the 16px threshold.
    expect(report?.summary.jumpWhileTouching).toBe(2);
    // Only the second one carried a write.
    expect(report?.summary.writtenWhileTouching).toBe(1);
  });
});
