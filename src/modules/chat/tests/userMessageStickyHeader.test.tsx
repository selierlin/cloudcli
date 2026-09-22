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
    expect(getByText("第二句提问全文内容").parentElement!.className).toContain("sticky");
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

  it("keeps its slot but turns invisible when the user message spans the panel top edge", () => {
    const { container, getByText } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;

    // q1 is arriving back: its row spans the top edge (negative top, positive bottom).
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    vi.spyOn(q1, "getBoundingClientRect").mockReturnValue(rect(-120, 60));

    fireEvent.scroll(container);

    // The button stays mounted (its flow slot must not shift the rows being
    // measured) and only hides visually.
    const headerButton = getByText("第一句提问全文内容").closest("button")!;
    expect(headerButton.className).toContain("invisible");
    expect(headerButton.className).toContain("pointer-events-none");
  });

  it("releases the slot only after the user message has fully arrived back in view", () => {
    const { container, queryByText } = renderHeader(new Map([["q1", "第一句提问全文内容"]]));
    const q1 = container.querySelector<HTMLElement>('[data-user-anchor="q1"]')!;
    const q1Rect = vi.spyOn(q1, "getBoundingClientRect");

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(0, 460));
    q1Rect.mockReturnValue(rect(-120, 60));
    fireEvent.scroll(container);
    // Bridging: mounted but invisible.
    expect(queryByText("第一句提问全文内容")).toBeTruthy();

    // Fully back in view: nothing is scrolled off anymore, so the header
    // unmounts back to the zero-height stand-in.
    q1Rect.mockReturnValue(rect(50, 200));
    fireEvent.scroll(container);
    expect(queryByText("第一句提问全文内容")).toBeNull();
  });

  it("re-shows the earlier anchor once the arriving message is fully in view", () => {
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
    expect(getByText("第一句提问全文内容").closest("button")!.className).toContain("invisible");

    // q2 fully visible: q1 owns the header again, visibly.
    q2Rect.mockReturnValue(rect(50, 200));
    fireEvent.scroll(container);
    const headerButton = getByText("第一句提问全文内容").closest("button")!;
    expect(headerButton.className).not.toContain("invisible");
    expect(headerButton.className).toContain("sticky");
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
});