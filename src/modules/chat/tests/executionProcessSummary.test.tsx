import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ExecutionProcessSummary from "@/modules/chat/transcript/ExecutionProcessSummary";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? "",
  }),
}));

const renderSummary = (collapsed: boolean) =>
  render(
    <ExecutionProcessSummary
      collapsed={collapsed}
      hasAttention={false}
      isActiveRun={false}
      isWindowTruncated={false}
      labelKind="execution"
      provider="workbuddy"
      processEndKey="process:test"
      toolCount={17}
      onToggle={() => {}}
    />,
  );

describe("execution process summary", () => {
  it("keeps the harness's full message header visible when its process rows are folded", () => {
    const view = renderSummary(true);

    expect(view.getByAltText("WorkBuddy")).toBeTruthy();
    expect(view.getByText("WorkBuddy")).toBeTruthy();
    expect(
      view.container.querySelector("img")?.compareDocumentPosition(view.getByRole("button")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("keeps the harness header above the summary when the process is open", () => {
    const view = renderSummary(false);

    expect(
      view.container.querySelector("img")?.compareDocumentPosition(view.getByRole("button")),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("sticks its expanded header so the disclosure remains reachable", () => {
    const view = renderSummary(false);
    const summary = view.getByRole("button");

    expect(summary.className).toContain("sticky");
    // The pane has pt-3/sm:pt-4 padding, so the pin must be nudged up by the
    // same amount (negative top) to sit flush against the panel edge.
    expect(summary.className).toContain("-top-3");
    expect(summary.className).toContain("sm:-top-4");
    expect(summary.className).toContain("z-10");
  });

  it("does not make a collapsed header sticky", () => {
    const view = renderSummary(true);

    expect(view.getByRole("button").className).not.toContain("sticky");
  });

  it("stops sticking when the process end reaches the chat panel top", () => {
    const view = render(
      <div className="chat-messages-pane">
        <ExecutionProcessSummary
          collapsed={false}
          hasAttention={false}
          isActiveRun={false}
          isWindowTruncated={false}
          labelKind="execution"
          provider="workbuddy"
          processEndKey="process:test"
          toolCount={17}
          onToggle={() => {}}
        />
        <div data-execution-process-end="process:test" />
      </div>,
    );
    const panel = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
    const summary = view.getByRole("button");
    const endMarker = view.container.querySelector<HTMLElement>("[data-execution-process-end]")!;

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({ top: -4, height: 28 } as DOMRect);
    vi.spyOn(endMarker, "getBoundingClientRect").mockReturnValue({ top: 20 } as DOMRect);

    fireEvent.scroll(panel);

    expect(summary.className).not.toContain("sticky");
  });

  it("does not restick within the reengage margin after unglueing", () => {
    const view = render(
      <div className="chat-messages-pane">
        <ExecutionProcessSummary
          collapsed={false}
          hasAttention={false}
          isActiveRun={false}
          isWindowTruncated={false}
          labelKind="execution"
          provider="workbuddy"
          processEndKey="process:test"
          toolCount={17}
          onToggle={() => {}}
        />
        <div data-execution-process-end="process:test" />
      </div>,
    );
    const panel = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
    const summary = view.getByRole("button");
    const endMarker = view.container.querySelector<HTMLElement>("[data-execution-process-end]")!;

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    const summaryRect = vi
      .spyOn(summary, "getBoundingClientRect")
      .mockReturnValue({ top: 0, height: 28 } as DOMRect);
    const endRect = vi.spyOn(endMarker, "getBoundingClientRect");

    // Mid-process: tail far below the pinned title -> stuck.
    endRect.mockReturnValue({ top: 200 } as DOMRect);
    fireEvent.scroll(panel);
    expect(summary.className).toContain("sticky");

    // Tail reaches the pin area -> unglue.
    endRect.mockReturnValue({ top: 20 } as DOMRect);
    fireEvent.scroll(panel);
    expect(summary.className).not.toContain("sticky");

    // A small scroll-back that stays inside the reengage margin stays free —
    // this is the boundary jitter that used to make the title flicker.
    endRect.mockReturnValue({ top: 40 } as DOMRect);
    fireEvent.scroll(panel);
    expect(summary.className).not.toContain("sticky");

    // Scroll back far enough to clear the margin -> restick decisively.
    endRect.mockReturnValue({ top: 80 } as DOMRect);
    fireEvent.scroll(panel);
    expect(summary.className).toContain("sticky");

    summaryRect.mockRestore();
    endRect.mockRestore();
  });

  it("stacks the pinned title below a visibly pinned user-message header", () => {
    const view = render(
      <div className="chat-messages-pane" style={{ paddingTop: "12px" }}>
        <div data-user-sticky-header data-pinned style={{ top: "-12px" }} />
        <ExecutionProcessSummary
          collapsed={false}
          hasAttention={false}
          isActiveRun={false}
          isWindowTruncated={false}
          labelKind="execution"
          provider="workbuddy"
          processEndKey="process:test"
          toolCount={17}
          onToggle={() => {}}
        />
        <div data-execution-process-end="process:test" />
      </div>,
    );
    const panel = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
    const summary = view.getByRole("button");
    const endMarker = view.container.querySelector<HTMLElement>("[data-execution-process-end]")!;
    const headerBand = view.container.querySelector<HTMLElement>("[data-user-sticky-header]")!;

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(headerBand, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({ top: -4, height: 28 } as DOMRect);
    vi.spyOn(endMarker, "getBoundingClientRect").mockReturnValue({ top: 200 } as DOMRect);

    fireEvent.scroll(panel);

    expect(summary.className).toContain("sticky");
    // Band bottom (40) minus the pane padding the class pin cancels (12).
    expect(summary.style.top).toBe("28px");
  });

  it("derives the stacked top from the live pane padding for the wider breakpoint", () => {
    const view = render(
      <div className="chat-messages-pane" style={{ paddingTop: "16px" }}>
        <div data-user-sticky-header data-pinned />
        <ExecutionProcessSummary
          collapsed={false}
          hasAttention={false}
          isActiveRun={false}
          isWindowTruncated={false}
          labelKind="execution"
          provider="workbuddy"
          processEndKey="process:test"
          toolCount={17}
          onToggle={() => {}}
        />
        <div data-execution-process-end="process:test" />
      </div>,
    );
    const panel = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
    const summary = view.getByRole("button");
    const endMarker = view.container.querySelector<HTMLElement>("[data-execution-process-end]")!;
    const headerBand = view.container.querySelector<HTMLElement>("[data-user-sticky-header]")!;

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(headerBand, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({ top: -4, height: 28 } as DOMRect);
    vi.spyOn(endMarker, "getBoundingClientRect").mockReturnValue({ top: 200 } as DOMRect);

    fireEvent.scroll(panel);

    // Same band, sm: pane padding — the top must differ from the 12px case,
    // proving the padding is really read rather than hardcoded.
    expect(summary.style.top).toBe("24px");
  });

  it("stacks below the background-tasks band as well when both bands show", () => {
    const view = render(
      <div className="chat-messages-pane" style={{ paddingTop: "12px" }}>
        <div data-user-sticky-header data-pinned />
        <div data-background-tasks-band />
        <ExecutionProcessSummary
          collapsed={false}
          hasAttention={false}
          isActiveRun={false}
          isWindowTruncated={false}
          labelKind="execution"
          provider="workbuddy"
          processEndKey="process:test"
          toolCount={17}
          onToggle={() => {}}
        />
        <div data-execution-process-end="process:test" />
      </div>,
    );
    const panel = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
    const summary = view.getByRole("button");
    const endMarker = view.container.querySelector<HTMLElement>("[data-execution-process-end]")!;
    const headerBand = view.container.querySelector<HTMLElement>("[data-user-sticky-header]")!;
    const tasksBand = view.container.querySelector<HTMLElement>("[data-background-tasks-band]")!;

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(headerBand, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
    vi.spyOn(tasksBand, "getBoundingClientRect").mockReturnValue({ top: 52, bottom: 82, height: 30 } as DOMRect);
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({ top: -4, height: 28 } as DOMRect);
    vi.spyOn(endMarker, "getBoundingClientRect").mockReturnValue({ top: 200 } as DOMRect);

    fireEvent.scroll(panel);

    // The title would overlap the tasks band at the header-stacked position
    // (40 + 28 > 52), so it must drop below the lower band instead.
    expect(summary.style.top).toBe("70px");
  });

  it("keeps the class pin when only the lower tasks band shows without the header", () => {
    const view = render(
      <div className="chat-messages-pane" style={{ paddingTop: "12px" }}>
        <div data-background-tasks-band />
        <ExecutionProcessSummary
          collapsed={false}
          hasAttention={false}
          isActiveRun={false}
          isWindowTruncated={false}
          labelKind="execution"
          provider="workbuddy"
          processEndKey="process:test"
          toolCount={17}
          onToggle={() => {}}
        />
        <div data-execution-process-end="process:test" />
      </div>,
    );
    const panel = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
    const summary = view.getByRole("button");
    const endMarker = view.container.querySelector<HTMLElement>("[data-execution-process-end]")!;
    const tasksBand = view.container.querySelector<HTMLElement>("[data-background-tasks-band]")!;

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(tasksBand, "getBoundingClientRect").mockReturnValue({ top: 52, bottom: 82, height: 30 } as DOMRect);
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({ top: -4, height: 28 } as DOMRect);
    vi.spyOn(endMarker, "getBoundingClientRect").mockReturnValue({ top: 200 } as DOMRect);

    fireEvent.scroll(panel);

    // The tasks band sits fully below the panel-top title zone, so the pin
    // must stay exactly where it was before the band existed.
    expect(summary.className).toContain("sticky");
    expect(summary.style.top).toBe("");
  });

  it("returns to the class pin when the header band stops showing", async () => {
    const view = render(
      <div className="chat-messages-pane" style={{ paddingTop: "12px" }}>
        <div data-user-sticky-header data-pinned />
        <ExecutionProcessSummary
          collapsed={false}
          hasAttention={false}
          isActiveRun={false}
          isWindowTruncated={false}
          labelKind="execution"
          provider="workbuddy"
          processEndKey="process:test"
          toolCount={17}
          onToggle={() => {}}
        />
        <div data-execution-process-end="process:test" />
      </div>,
    );
    const panel = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
    const summary = view.getByRole("button");
    const endMarker = view.container.querySelector<HTMLElement>("[data-execution-process-end]")!;
    const headerBand = view.container.querySelector<HTMLElement>("[data-user-sticky-header]")!;

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(headerBand, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({ top: -4, height: 28 } as DOMRect);
    vi.spyOn(endMarker, "getBoundingClientRect").mockReturnValue({ top: 200 } as DOMRect);

    fireEvent.scroll(panel);
    expect(summary.style.top).toBe("28px");

    // The header bridges out for an arriving message: its slot stays but the
    // pinned marker drops, and the offset must follow without any scroll.
    await act(async () => {
      headerBand.removeAttribute("data-pinned");
    });
    expect(summary.style.top).toBe("");
  });

  it("holds the pin only until the process tail reaches the lowered pin", () => {
    const view = render(
      <div className="chat-messages-pane" style={{ paddingTop: "12px" }}>
        <div data-user-sticky-header data-pinned />
        <ExecutionProcessSummary
          collapsed={false}
          hasAttention={false}
          isActiveRun={false}
          isWindowTruncated={false}
          labelKind="execution"
          provider="workbuddy"
          processEndKey="process:test"
          toolCount={17}
          onToggle={() => {}}
        />
        <div data-execution-process-end="process:test" />
      </div>,
    );
    const panel = view.container.querySelector<HTMLElement>(".chat-messages-pane")!;
    const summary = view.getByRole("button");
    const endMarker = view.container.querySelector<HTMLElement>("[data-execution-process-end]")!;
    const headerBand = view.container.querySelector<HTMLElement>("[data-user-sticky-header]")!;
    const endRect = vi.spyOn(endMarker, "getBoundingClientRect");

    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(headerBand, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 40, height: 40 } as DOMRect);
    vi.spyOn(summary, "getBoundingClientRect").mockReturnValue({ top: -4, height: 28 } as DOMRect);

    // Still clear of the lowered pin zone plus the reengage margin -> stuck.
    endRect.mockReturnValue({ top: 120 } as DOMRect);
    fireEvent.scroll(panel);
    expect(summary.className).toContain("sticky");

    // Would clear the old panel-top pin (0 + 28) but not the lowered one —
    // the answer text must not slide behind the stacked title.
    endRect.mockReturnValue({ top: 50 } as DOMRect);
    fireEvent.scroll(panel);
    expect(summary.className).not.toContain("sticky");
  });
});
