import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/shared/types";
import { deriveUserMessageAnchors } from "@/modules/chat/utils/userMessageAnchors";

const msg = (overrides: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  type: "assistant",
  timestamp: overrides.id,
  ...overrides,
} as ChatMessage);

const getMessageKey = (message: ChatMessage) => String(message.id ?? message.timestamp);

describe("deriveUserMessageAnchors", () => {
  it("anchors every user message that has a following assistant reply", () => {
    const messages = [
      msg({ id: "q1", type: "user", content: "How does the quota work?" }),
      msg({ id: "a1", type: "assistant", content: "The quota works like so..." }),
      msg({ id: "q2", type: "user", content: "And the billing?" }),
      msg({ id: "a2", type: "assistant", content: "Billing is monthly." }),
    ];

    const anchors = deriveUserMessageAnchors(messages, getMessageKey);

    expect([...anchors.keys()]).toEqual(["q1", "q2"]);
    expect(anchors.get("q1")).toBe("How does the quota work?");
    expect(anchors.get("q2")).toBe("And the billing?");
  });

  it("skips a user message with no reply", () => {
    const messages = [
      msg({ id: "q1", type: "user", content: "A question" }),
      msg({ id: "a1", type: "assistant", content: "Answer" }),
      msg({ id: "q2", type: "user", content: "A dangling question" }),
    ];

    const anchors = deriveUserMessageAnchors(messages, getMessageKey);

    expect(anchors.has("q1")).toBe(true);
    expect(anchors.has("q2")).toBe(false);
  });

  it("drops turns whose user anchor is absent (window starts mid-turn)", () => {
    const messages = [msg({ id: "a", type: "assistant", content: "No visible prompt before this." })];

    const anchors = deriveUserMessageAnchors(messages, getMessageKey);

    expect(anchors.size).toBe(0);
  });
});