import { fireEvent, render } from "@testing-library/react";
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
});
