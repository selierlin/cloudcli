import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

type GeometrySample = {
  frame: number;
  timestamp: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  bottomGap: number;
  anchorTop: number | null;
};

type ScrollWrite = {
  api: string;
  timestamp: number;
};

type InstrumentedWindow = Window & typeof globalThis & {
  __TRANSCRIPT_FIXTURE__?: {
    dispatch(step: { action: string; payload?: unknown }): Promise<{ actualBlockMs?: number; timestamp?: string }>;
    snapshot(): { messageCount: number; processing: boolean };
  };
  __TRANSCRIPT_GEOMETRY__?: {
    active: boolean;
    samples: GeometrySample[];
    frame: number;
  };
  __TRANSCRIPT_SCROLL_WRITES__?: ScrollWrite[];
};

async function installScrollInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const instrumentedWindow = window as InstrumentedWindow;
    const writes: ScrollWrite[] = [];
    instrumentedWindow.__TRANSCRIPT_SCROLL_WRITES__ = writes;

    const record = (api: string) => writes.push({ api, timestamp: performance.now() });
    const elementPrototype = Element.prototype as Element & Record<string, unknown>;
    const htmlElementPrototype = HTMLElement.prototype as HTMLElement & Record<string, unknown>;

    for (const methodName of ['scrollTo', 'scrollBy', 'scrollIntoView'] as const) {
      const owner = methodName === 'scrollIntoView' ? elementPrototype : htmlElementPrototype;
      const original = owner[methodName];
      if (typeof original !== 'function') continue;
      owner[methodName] = function instrumentedScrollMethod(this: Element, ...args: unknown[]) {
        record(methodName);
        return Reflect.apply(original, this, args);
      };
    }

    for (const propertyName of ['scrollTop', 'scrollLeft'] as const) {
      let owner: object | null = HTMLElement.prototype;
      let descriptor: PropertyDescriptor | undefined;
      while (owner && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(owner, propertyName);
        if (!descriptor) owner = Object.getPrototypeOf(owner);
      }
      if (!owner || !descriptor?.get || !descriptor.set) continue;
      Object.defineProperty(HTMLElement.prototype, propertyName, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value: number) {
          record(propertyName);
          return descriptor?.set?.call(this, value);
        },
      });
    }
  });
}

async function openFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__));
  await page.evaluate(async () => {
    const controller = (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__;
    await controller?.dispatch({ action: 'seed-stable' });
  });
  await expect(page.getByTestId('transcript-fixture')).toBeVisible();
}

async function beginGeometrySampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const instrumentedWindow = window as InstrumentedWindow;
    const state = { active: true, samples: [] as GeometrySample[], frame: 0 };
    instrumentedWindow.__TRANSCRIPT_GEOMETRY__ = state;

    const sample = (timestamp: number) => {
      if (!state.active) return;
      const container = document.querySelector<HTMLElement>('.chat-messages-pane');
      const anchors = container?.querySelectorAll<HTMLElement>('[data-message-timestamp]');
      const anchor = anchors?.item(Math.max(0, (anchors?.length ?? 1) - 1)) ?? null;
      if (container) {
        state.samples.push({
          frame: state.frame,
          timestamp,
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
          bottomGap: container.scrollHeight - container.scrollTop - container.clientHeight,
          anchorTop: anchor?.getBoundingClientRect().top ?? null,
        });
        state.frame += 1;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function waitForFrames(page: Page, count: number): Promise<void> {
  const startFrame = await page.evaluate(
    () => (window as InstrumentedWindow).__TRANSCRIPT_GEOMETRY__?.samples.length ?? 0,
  );
  await page.waitForFunction(
    ({ start, required }) => (
      ((window as InstrumentedWindow).__TRANSCRIPT_GEOMETRY__?.samples.length ?? 0) >= start + required
    ),
    { start: startFrame, required: count },
  );
}

async function finishGeometrySampling(page: Page): Promise<GeometrySample[]> {
  return page.evaluate(() => {
    const state = (window as InstrumentedWindow).__TRANSCRIPT_GEOMETRY__;
    if (!state) return [];
    state.active = false;
    return state.samples;
  });
}

function positiveBottomGapSpike(samples: GeometrySample[]): number {
  const baseline = samples.slice(0, 3).reduce((sum, sample) => sum + sample.bottomGap, 0) / 3;
  return Math.max(...samples.map((sample) => Math.max(0, sample.bottomGap - baseline)));
}

async function attachTimeline(testInfo: TestInfo, page: Page, samples: GeometrySample[]): Promise<void> {
  const metadata = {
    browserName: testInfo.project.name,
    browserVersion: await page.context().browser()?.version(),
    samples,
    scrollWrites: await page.evaluate(
      () => (window as InstrumentedWindow).__TRANSCRIPT_SCROLL_WRITES__ ?? [],
    ),
  };
  await testInfo.attach('transcript-geometry.json', {
    body: Buffer.from(JSON.stringify(metadata, null, 2)),
    contentType: 'application/json',
  });
}

test.beforeEach(async ({ page }) => {
  await installScrollInstrumentation(page);
});

test('stable baseline keeps geometry unchanged', async ({ page }, testInfo) => {
  await openFixture(page);
  await beginGeometrySampling(page);
  await waitForFrames(page, 8);
  const samples = await finishGeometrySampling(page);
  await attachTimeline(testInfo, page, samples);

  expect(samples.length).toBeGreaterThanOrEqual(8);
  expect(positiveBottomGapSpike(samples)).toBeLessThanOrEqual(1);
});

test('negative fixture is detected as a large bottom-gap spike', async ({ page }, testInfo) => {
  await openFixture(page);
  await beginGeometrySampling(page);
  await waitForFrames(page, 4);
  await page.evaluate(async () => {
    await (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__?.dispatch({
      action: 'inject-negative-gap',
      payload: 360,
    });
  });
  await waitForFrames(page, 4);
  const samples = await finishGeometrySampling(page);
  await attachTimeline(testInfo, page, samples);
  await testInfo.attach('negative-fixture.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  expect(positiveBottomGapSpike(samples)).toBeGreaterThanOrEqual(300);
});

test('busy-loop duration is real and scrollIntoView remains observable', async ({ page }) => {
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const instrumentedWindow = window as InstrumentedWindow;
    const block = await instrumentedWindow.__TRANSCRIPT_FIXTURE__?.dispatch({
      action: 'block-main-thread',
      payload: 100,
    });
    document.querySelector<HTMLElement>('[data-message-timestamp]')?.scrollIntoView({ block: 'center' });
    return {
      actualBlockMs: block?.actualBlockMs ?? 0,
      scrollApis: instrumentedWindow.__TRANSCRIPT_SCROLL_WRITES__?.map((write) => write.api) ?? [],
    };
  });

  expect(result.actualBlockMs).toBeGreaterThanOrEqual(95);
  expect(result.scrollApis).toContain('scrollIntoView');
});

test('first visible tool node survives when the second tool creates a group', async ({ page }) => {
  await openFixture(page);
  const firstTool = await page.evaluate(async () => (
    (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__?.dispatch({ action: 'append-tool' })
  ));
  expect(firstTool?.timestamp).toBeTruthy();

  const firstToolNode = page.locator(`.chat-message[data-message-timestamp="${firstTool?.timestamp}"]`);
  await expect(firstToolNode).toBeVisible();
  await firstToolNode.evaluate((element) => {
    element.setAttribute('data-mount-probe', 'original');
  });

  await page.evaluate(async () => {
    await (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__?.dispatch({ action: 'append-tool' });
  });

  await expect(firstToolNode).toBeVisible();
  await expect(firstToolNode).toHaveAttribute('data-mount-probe', 'original');
});

test('long reasoning collapse stays pinned while final prose takes over', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const longReasoning = Array.from(
      { length: 120 },
      (_, index) => `思考段落 ${index + 1}：持续检查动态 transcript 的布局与滚动锚点。`,
    ).join('\n\n');
    const controller = (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__;
    await controller?.dispatch({ action: 'append-thinking', payload: longReasoning });
    await controller?.dispatch({ action: 'finalize-stream' });
    await controller?.dispatch({ action: 'scroll-bottom' });
  });

  const reasoningContent = page.locator('.reasoning-collapse-content').last();
  await expect(reasoningContent).toHaveAttribute('data-state', 'open');
  await beginGeometrySampling(page);
  await waitForFrames(page, 4);
  await page.evaluate(async () => {
    await (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__?.dispatch({
      action: 'append-text',
      payload: '正文已经开始输出，上一段思考应当平滑交接。',
    });
  });
  await expect(reasoningContent).toHaveAttribute('data-state', 'closed', { timeout: 4_000 });
  await waitForFrames(page, 6);
  const samples = await finishGeometrySampling(page);
  await attachTimeline(testInfo, page, samples);

  expect(positiveBottomGapSpike(samples)).toBeLessThanOrEqual(24);
});

type TopChromeSample = {
  state: string;
  scrollTop: number;
  slotHeight: number;
  firstRowTop: number;
  overlayWrapperHeight: number;
};

/**
 * Applies one top-chrome state and reads the three boxes RS06 is about: the
 * bar's own outer box, the first transcript row below it, and the load-all
 * overlay's wrapper height in normal flow.
 */
async function sampleTopChrome(page: Page, state: string): Promise<TopChromeSample> {
  return page.evaluate(async (name) => {
    await (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__?.dispatch({
      action: 'set-top-chrome',
      payload: name,
    });
    const container = document.querySelector<HTMLElement>('.chat-messages-pane');
    const slot = container?.querySelector<HTMLElement>('[data-transcript-top-chrome]');
    const overlay = container?.querySelector<HTMLElement>('[data-transcript-top-chrome-overlay]');
    const firstRow = container?.querySelector<HTMLElement>('[data-message-timestamp]');
    if (!container || !firstRow) throw new Error('transcript fixture is not mounted');
    return {
      state: name,
      scrollTop: container.scrollTop,
      slotHeight: slot?.getBoundingClientRect().height ?? 0,
      firstRowTop: firstRow.getBoundingClientRect().top,
      overlayWrapperHeight: overlay?.getBoundingClientRect().height ?? -1,
    };
  }, state);
}

test('top chrome bars swap without moving the transcript', async ({ page }, testInfo) => {
  await openFixture(page);

  const bars: TopChromeSample[] = [];
  for (const state of ['loading', 'counting', 'legacy']) {
    bars.push(await sampleTopChrome(page, state));
  }
  const withoutBar = await sampleTopChrome(page, 'none');
  await testInfo.attach('top-chrome.json', {
    body: Buffer.from(JSON.stringify({ browserName: testInfo.project.name, bars, withoutBar }, null, 2)),
    contentType: 'application/json',
  });

  // A moving transcript would make every comparison below meaningless.
  expect(new Set([...bars, withoutBar].map((sample) => sample.scrollTop)).size).toBe(1);

  const heights = bars.map((bar) => bar.slotHeight);
  expect(heights.every((height) => height > 0)).toBe(true);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);

  const rowTops = bars.map((bar) => bar.firstRowTop);
  expect(Math.max(...rowTops) - Math.min(...rowTops), JSON.stringify(bars)).toBeLessThanOrEqual(1);

  // The "no bar showing" state is not a special case: the slot stays mounted
  // after the last page loads, because unmounting it would move the rows by the
  // slot plus its space-y gap at exactly the moment the reader is up there.
  expect(Math.abs(withoutBar.firstRowTop - bars[0].firstRowTop), JSON.stringify({ bars, withoutBar })).toBeLessThanOrEqual(1);
  expect(Math.abs(withoutBar.slotHeight - bars[0].slotHeight)).toBeLessThanOrEqual(1);
});

test('top chrome bars stay equal on a phone viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFixture(page);

  const loading = await sampleTopChrome(page, 'loading');
  const counting = await sampleTopChrome(page, 'counting');
  const legacy = await sampleTopChrome(page, 'legacy');
  await testInfo.attach('top-chrome-phone.json', {
    body: Buffer.from(JSON.stringify({
      browserName: testInfo.project.name,
      loading,
      counting,
      legacy,
    }, null, 2)),
    contentType: 'application/json',
  });

  expect(new Set([loading, counting, legacy].map((sample) => sample.scrollTop)).size).toBe(1);

  // The per-page-load swap is the one a reader hits repeatedly, so it has to
  // hold on the narrow viewport too.
  expect(Math.abs(loading.slotHeight - counting.slotHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(loading.firstRowTop - counting.firstRowTop)).toBeLessThanOrEqual(1);

  // The legacy bar drops its count sentence on narrow viewports for this
  // reason: with it the sentence plus two buttons wrapped to a second line and
  // the slot grew to 57px against the others' 40px, so rows moved when the last
  // page finished loading. It has to match the other two exactly, not "by less
  // than a line".
  expect(legacy.slotHeight).toBe(loading.slotHeight);
  expect(legacy.slotHeight).toBe(counting.slotHeight);
  expect(Math.abs(legacy.firstRowTop - counting.firstRowTop)).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-transcript-top-chrome] button')).toHaveCount(2);
});

test('top chrome slot holds its height in the longest locale', async ({ page }, testInfo) => {
  // Russian is the wordiest of the bundled locales, and the only one that grew
  // the slot in all four states. The zh-CN measurements above catch the legacy
  // bar but not the counting one: at 390px the Chinese text stays at 40px while
  // de/fr/es/it/ru/tr wrap that row to 57px.
  await page.addInitScript(() => {
    localStorage.setItem('user-preferences', JSON.stringify({ userLanguage: 'ru' }));
  });

  for (const width of [390, 640]) {
    await page.setViewportSize({ width, height: 844 });
    await openFixture(page);

    const samples: TopChromeSample[] = [];
    for (const state of ['none', 'loading', 'counting', 'legacy']) {
      samples.push(await sampleTopChrome(page, state));
    }
    await testInfo.attach(`top-chrome-ru-${width}.json`, {
      body: Buffer.from(JSON.stringify({ browserName: testInfo.project.name, samples }, null, 2)),
      contentType: 'application/json',
    });

    // No state may be a pixel taller than the others: a row that wraps is the
    // whole bug, and an ellipsis is the acceptable way for it not to.
    expect(new Set(samples.map((sample) => sample.slotHeight)).size, JSON.stringify(samples)).toBe(1);
    expect(new Set(samples.map((sample) => sample.firstRowTop)).size, JSON.stringify(samples)).toBe(1);
  }
});

test('load-all overlay shows and hides without moving the transcript', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.evaluate(() => {
    document
      .querySelector('[data-transcript-top-chrome-overlay]')
      ?.setAttribute('data-overlay-probe', 'original');
  });

  const before = await sampleTopChrome(page, 'counting');
  await page.evaluate(async () => {
    await (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__?.dispatch({
      action: 'set-load-all-overlay',
      payload: true,
    });
  });
  const overlay = page.locator('[data-transcript-top-chrome-overlay]');
  await expect(overlay.locator('button')).toBeVisible();
  const shown = await sampleTopChrome(page, 'counting');

  await page.evaluate(async () => {
    await (window as InstrumentedWindow).__TRANSCRIPT_FIXTURE__?.dispatch({
      action: 'set-load-all-overlay',
      payload: false,
    });
  });
  const hidden = await sampleTopChrome(page, 'counting');

  await testInfo.attach('load-all-overlay.json', {
    body: Buffer.from(JSON.stringify({ browserName: testInfo.project.name, before, shown, hidden }, null, 2)),
    contentType: 'application/json',
  });

  // The wrapper has to survive the pill: unmounting it removes a sticky element
  // from inside the scroll container, which drops the rows below by its margin
  // and suppresses native scroll anchoring while it is gone.
  await expect(overlay).toHaveAttribute('data-overlay-probe', 'original');
  expect(shown.overlayWrapperHeight).toBe(0);
  expect(hidden.overlayWrapperHeight).toBe(0);
  expect(new Set([before.scrollTop, shown.scrollTop, hidden.scrollTop]).size).toBe(1);
  expect(Math.abs(shown.firstRowTop - before.firstRowTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(hidden.firstRowTop - before.firstRowTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(shown.slotHeight - before.slotHeight)).toBeLessThanOrEqual(1);
  await expect(overlay.locator('button')).toHaveCount(0);
});
