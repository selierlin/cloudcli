import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import UserMessageStickyHeader from "@/modules/chat/transcript/UserMessageStickyHeader";

const renderHeader = (anchorTexts: Map<string, string>) => {
  const view = render(
    <div className="chat-messages-pane">
      <UserMessageStickyHeader anchorTexts={anchorTexts} />
      <div data-user-anchor="q1">Q1</div>
      <div data-user-anchor="q2">Q2</div>
    </div>,
  );
  const container = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
  return { ...view, container };
};

const rect = (top: number, bottom: number) => ({ top, bottom } as DOMRect);

describe("user message sticky header", () => {
  it("pins the user message fully scrolled off the top", () => {
    const { container, getByText } = renderHeader(
      new Map([
        ["q1", "第一句提问全文内容"],
        ["q2", "第二句提问全文内容"],
      ]),
    );

    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q2 = container.querySelector<HTMLElement>('[data-user-anchor="q2"]')!;

    // q2 has fully scrolled off the top; q1 is still below the panel.
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(600, 700));
    vi.spyOn(q2, "getBoundingClientRect").mockReturnValue(rect(-500, -300));

    fireEvent.scroll(container);

    expect(getByText("第二句提问全文内容")).toBeTruthy();
    // The band floats in a zero-height sticky layer: the layer pins, the button
    // inside it is positioned so it takes the transcript's height out of play.
    const headerButton = getByText("第二句提问全文内容").closest("button")!;
    expect(headerButton.parentElement!.className).toContain("sticky");
    expect(headerButton.parentElement!.className).toContain("h-0");
    expect(headerButton.className).toContain("absolute");
    expect(headerButton.dataset.stickyState).toBe("pinned");
  });

  it("picks the most recently scrolled-off anchor, not the deepest one", () => {
    const { container, getByText } = renderHeader(
      new Map([["q1", "第一句提问全文内容"], ["q2", "第二句提问全文内容"]]),
    );

    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q2 = container.querySelector<HTMLElement>('[data-user-anchor="q2"]')!;

    // Both fully above; q1 is the closest to the panel top.
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(-80, -10));
    vi.spyOn(q2, "getBoundingClientRect").mockReturnValue(rect(-500, -400));

    fireEvent.scroll(container);

    expect(getByText("第一句提问全文内容")).toBeTruthy();
  });

  it("hides while the arriving user message spans the panel top edge", () => {
    const { container, getByText } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;

    // q1 is arriving back: its row spans the top edge (negative top, positive bottom).
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(-120, 60));

    fireEvent.scroll(container);

    // The button stays mounted (the scroll listener resolves its container
    // through this node) and only hides visually.
    const headerButton = getByText("第一句提问全文内容").closest("button")!;
    expect(headerButton.className).toContain("invisible");
    expect(headerButton.className).toContain("pointer-events-none");
    // The recorder reads this marker to time each shown/hidden flip.
    expect(headerButton.dataset.stickyState).toBe("bridging");
  });

  it("steps aside once the arriving message is under the band's own strip", () => {
    const { container } = renderHeader(
      new Map([
        ["q1", "第一句提问全文内容"],
        ["q2", "第二句提问全文内容"],
      ]),
    );
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q2 = container.querySelector<HTMLElement>('[data-user-anchor="q2"]')!;
    // The band's covered strip is the top 22px of the pane, as on screen.
    const headerButton = container.querySelector<HTMLButtonElement>("button")!;
    vi.spyOn(headerButton, "getBoundingClientRect").mockReturnValue(rect(-12, 22));

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(-80, -10));
    // q2 is fully visible but its question bubble starts inside that strip.
    vi.spyOn(q2, "getBoundingClientRect").mockReturnValue(rect(5, 200));

    fireEvent.scroll(container);

    // Covering a question it is supposed to summarise is worse than showing
    // nothing, so the band hides instead of pinning q1 above q2's bubble.
    expect(headerButton.className).toContain("invisible");
    expect(headerButton.dataset.stickyState).toBe("bridging");
  });

  it("releases the band only after the user message has fully arrived back in view", () => {
    const { container, queryByText } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q1Rect = vi.spyOn(q1, "getBoundingClientRect");

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    q1Rect.mockReturnValue(rect(-120, 60));
    fireEvent.scroll(container);
    // Bridging: mounted but invisible.
    expect(queryByText("第一句提问全文内容")).toBeTruthy();

    // Fully back in view: nothing is scrolled off anymore and nothing is under
    // the band, so it has no section to name and empties out.
    q1Rect.mockReturnValue(rect(50, 200));
    fireEvent.scroll(container);
    expect(queryByText("第一句提问全文内容")).toBeNull();
  });

  it("re-shows the earlier anchor once the arriving message has cleared the band", () => {
    const { container, getByText } = renderHeader(
      new Map([
        ["q1", "第一句提问全文内容"],
        ["q2", "第二句提问全文内容"],
      ]),
    );
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q2 = container.querySelector<HTMLElement>('[data-user-anchor="q2"]')!;
    const q2Rect = vi.spyOn(q2, "getBoundingClientRect");

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    // q1 fully scrolled off, q2 spans the top edge: invisible while q2 arrives.
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(-80, -10));
    q2Rect.mockReturnValue(rect(-120, 60));
    fireEvent.scroll(container);
    // q2's own row is arriving, so q2 is what the hidden band holds.
    expect(getByText("第二句提问全文内容").closest("button")!.className).toContain("invisible");

    // q2 fully visible and clear of the band: q1 owns the header again, visibly.
    q2Rect.mockReturnValue(rect(50, 200));
    fireEvent.scroll(container);
    const headerButton = getByText("第一句提问全文内容").closest("button")!;
    expect(headerButton.className).not.toContain("invisible");
    expect(headerButton.parentElement!.className).toContain("sticky");
  });

  it("holds the band out while the arriving row hovers on the strip edge", () => {
    const { container } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q1Rect = vi.spyOn(q1, "getBoundingClientRect");
    const headerButton = container.querySelector<HTMLButtonElement>("button")!;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    // The band sits flush on the pane top, so its strip ends at y = 0.
    vi.spyOn(headerButton, "getBoundingClientRect").mockReturnValue(rect(-34, 0));

    q1Rect.mockReturnValue(rect(-120, 60));
    fireEvent.scroll(container);
    expect(headerButton.dataset.stickyState).toBe("bridging");

    // A phone hands back offsets that wander a pixel or two, which puts the
    // row's edge on the threshold frame after frame. Without a dead band the
    // state flips back here and the reader sees a flicker instead of a message.
    q1Rect.mockReturnValue(rect(2, 180));
    fireEvent.scroll(container);
    expect(headerButton.dataset.stickyState).toBe("bridging");

    // Well clear of the dead band, the band may come back.
    q1Rect.mockReturnValue(rect(6, 180));
    fireEvent.scroll(container);
    expect(headerButton.dataset.stickyState).toBe("absent");
  });

  it("renders nothing before any anchor has fully scrolled off the top", () => {
    const { container, queryByText } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(200, 300));

    fireEvent.scroll(container);

    expect(queryByText("第一句提问全文内容")).toBeNull();
  });

  it("scrolls back to the user message when clicked", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { writable: true, value: scrollIntoView });
    const { container, getByText } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q2 = container.querySelector<HTMLElement>('[data-user-anchor="q2"]')!;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(-100, -20));
    // Keep q2 deeply scrolled off so it never wins.
    vi.spyOn(q2, "getBoundingClientRect").mockReturnValue(rect(-900, -800));

    fireEvent.scroll(container);

    const headerButton = getByText("第一句提问全文内容").closest("button")!;
    fireEvent.click(headerButton);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(q1.classList.contains("search-highlight-flash")).toBe(true);
  });

  it("marks itself as a sticky band for the process title while visibly pinned", () => {
    const { container, getByText } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q2 = container.querySelector<HTMLElement>('[data-user-anchor="q2"]')!;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(-100, -20));
    // Keep q2 deeply scrolled off so the unmocked zero rect never wins.
    vi.spyOn(q2, "getBoundingClientRect").mockReturnValue(rect(-900, -800));

    fireEvent.scroll(container);

    const headerButton = getByText("第一句提问全文内容").closest("button")!;
    expect(headerButton.dataset.userStickyHeader).toBe("true");
    expect(headerButton.dataset.pinned).toBe("true");
  });

  it("drops the pinned-band marker while bridging out for an arriving message", () => {
    const { container, getByText } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;

    // q1 is arriving back: its row spans the top edge, so the header turns
    // invisible and must not hold the process title below its slot.
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(-120, 60));

    fireEvent.scroll(container);

    const headerButton = getByText("第一句提问全文内容").closest("button")!;
    expect(headerButton.dataset.userStickyHeader).toBe("true");
    expect(headerButton.dataset.pinned).toBeUndefined();
  });

  it("carries no band marker before any anchor has scrolled off the top", () => {
    const { container } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(200, 300));

    fireEvent.scroll(container);

    const standIn = container.querySelector("button")!;
    expect(standIn.dataset.userStickyHeader).toBeUndefined();
    expect(standIn.dataset.pinned).toBeUndefined();
    expect(standIn.dataset.stickyState).toBe("absent");
  });
});