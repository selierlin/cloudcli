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
