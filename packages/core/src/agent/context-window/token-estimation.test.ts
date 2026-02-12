import { describe, it, expect, vi } from "vitest";
import {
  ESTIMATION_SAFETY_MARGIN,
  COMPACTION_TRIGGER_RATIO,
  COMPACTION_TARGET_RATIO,
  MIN_KEEP_MESSAGES,
  estimateSystemPromptTokens,
  estimateTokenUsage,
  shouldCompact,
  compactMessagesTokenAware,
  isMessageOversized,
} from "./token-estimation.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

// Mock the external estimateTokens function
vi.mock("@mariozechner/pi-coding-agent", () => ({
  estimateTokens: (message: AgentMessage) => {
    // Simple mock: count characters / 4 (rough token estimate)
    if (message.role === "user") {
      const content = message.content;
      if (typeof content === "string") {
        return Math.ceil(content.length / 4);
      }
      return 50; // Default for complex content
    }
    if (message.role === "assistant") {
      const msg = message as any;
      if (typeof msg.content === "string") {
        return Math.ceil(msg.content.length / 4);
      }
      return 100; // Default for tool use content
    }
    return 50;
  },
}));

describe("token-estimation", () => {
  describe("constants", () => {
    it("should have correct safety margin", () => {
      expect(ESTIMATION_SAFETY_MARGIN).toBe(1.5);
    });

    it("should have correct compaction trigger ratio", () => {
      expect(COMPACTION_TRIGGER_RATIO).toBe(0.8);
    });

    it("should have correct compaction target ratio", () => {
      expect(COMPACTION_TARGET_RATIO).toBe(0.5);
    });

    it("should have correct minimum keep messages", () => {
      expect(MIN_KEEP_MESSAGES).toBe(10);
    });
  });

  describe("estimateSystemPromptTokens", () => {
    it("should return 0 for undefined system prompt", () => {
      expect(estimateSystemPromptTokens(undefined)).toBe(0);
    });

    it("should return 0 for empty string", () => {
      expect(estimateSystemPromptTokens("")).toBe(0);
    });

    it("should estimate tokens based on character count", () => {
      // ~2 chars per token (conservative for CJK/mixed content)
      expect(estimateSystemPromptTokens("ab")).toBe(1);
      expect(estimateSystemPromptTokens("abcd")).toBe(2);
      expect(estimateSystemPromptTokens("abcdef")).toBe(3);
    });

    it("should ceil the result", () => {
      // 3 chars / 2 = 1.5, should ceil to 2
      expect(estimateSystemPromptTokens("abc")).toBe(2);
    });

    it("should handle long prompts", () => {
      const longPrompt = "a".repeat(3000);
      expect(estimateSystemPromptTokens(longPrompt)).toBe(1500);
    });
  });

  describe("estimateTokenUsage", () => {
    it("should calculate token usage correctly", () => {
      const messages = [
        { role: "user", content: "Hello world" }, // ~3 tokens
        { role: "assistant", content: "Hi there!" }, // ~3 tokens
      ] as AgentMessage[];

      const result = estimateTokenUsage({
        messages,
        systemPrompt: "You are a helpful assistant.", // ~10 tokens
        contextWindowTokens: 8000,
      });

      expect(result.messageTokens).toBeGreaterThan(0);
      expect(result.systemPromptTokens).toBeGreaterThan(0);
      expect(result.availableTokens).toBeLessThan(8000);
      expect(result.utilizationRatio).toBeGreaterThanOrEqual(0);
    });

    it("should use default reserve tokens when not specified", () => {
      const result = estimateTokenUsage({
        messages: [],
        contextWindowTokens: 8000,
      });

      // Available = 8000 - 0 (no system) - 1024 (default reserve)
      expect(result.availableTokens).toBe(8000 - 1024);
    });

    it("should use custom reserve tokens when specified", () => {
      const result = estimateTokenUsage({
        messages: [],
        contextWindowTokens: 8000,
        reserveTokens: 2000,
      });

      expect(result.availableTokens).toBe(8000 - 2000);
    });

    it("should not go negative for available tokens", () => {
      const result = estimateTokenUsage({
        messages: [],
        systemPrompt: "a".repeat(30000), // Huge system prompt
        contextWindowTokens: 8000,
      });

      expect(result.availableTokens).toBe(0);
    });

    it("should calculate utilization ratio with safety margin", () => {
      const messages = [
        { role: "user", content: "a".repeat(400) }, // ~100 tokens
      ] as AgentMessage[];

      const result = estimateTokenUsage({
        messages,
        contextWindowTokens: 2000,
        reserveTokens: 0,
      });

      // Utilization = (tokens * 1.5) / available
      expect(result.utilizationRatio).toBeGreaterThan(0);
    });
  });

  describe("shouldCompact", () => {
    it("should return true when utilization >= 80%", () => {
      expect(shouldCompact({
        messageTokens: 800,
        systemPromptTokens: 0,
        availableTokens: 1000,
        utilizationRatio: 0.8
      })).toBe(true);

      expect(shouldCompact({
        messageTokens: 900,
        systemPromptTokens: 0,
        availableTokens: 1000,
        utilizationRatio: 0.9
      })).toBe(true);
    });

    it("should return false when utilization < 80%", () => {
      expect(shouldCompact({
        messageTokens: 700,
        systemPromptTokens: 0,
        availableTokens: 1000,
        utilizationRatio: 0.7
      })).toBe(false);

      expect(shouldCompact({
        messageTokens: 100,
        systemPromptTokens: 0,
        availableTokens: 1000,
        utilizationRatio: 0.1
      })).toBe(false);
    });
  });

  describe("compactMessagesTokenAware", () => {
    function createMessages(count: number): AgentMessage[] {
      return Array.from({ length: count }, (_, i) => ({
        role: "user" as const,
        content: `Message ${i}: ${"x".repeat(100)}`, // Each ~28 tokens
      })) as AgentMessage[];
    }

    it("should return null if too few messages", () => {
      const messages = createMessages(5);
      const result = compactMessagesTokenAware(messages, 10000);
      expect(result).toBeNull();
    });

    it("should return null if already within target", () => {
      const messages = createMessages(15);
      // Very large available tokens means no compaction needed
      const result = compactMessagesTokenAware(messages, 100000);
      expect(result).toBeNull();
    });

    it("should compact messages when over target", () => {
      const messages = createMessages(20);
      // Small available tokens should trigger compaction
      const result = compactMessagesTokenAware(messages, 200, {
        targetRatio: 0.5,
        minKeepMessages: 5,
      });

      if (result) {
        expect(result.kept.length).toBeLessThan(20);
        expect(result.removedCount).toBeGreaterThan(0);
        expect(result.tokensRemoved).toBeGreaterThan(0);
      }
    });

    it("should keep at least minKeepMessages", () => {
      const messages = createMessages(20);
      const result = compactMessagesTokenAware(messages, 10, {
        targetRatio: 0.1,
        minKeepMessages: 12,
      });

      if (result) {
        expect(result.kept.length).toBeGreaterThanOrEqual(12);
      }
    });

    it("should keep newest messages (from the end)", () => {
      const messages = [
        { role: "user", content: "Old message 1" },
        { role: "user", content: "Old message 2" },
        { role: "user", content: "Old message 3" },
        { role: "user", content: "Old message 4" },
        { role: "user", content: "Old message 5" },
        { role: "user", content: "Old message 6" },
        { role: "user", content: "Old message 7" },
        { role: "user", content: "Old message 8" },
        { role: "user", content: "Old message 9" },
        { role: "user", content: "Old message 10" },
        { role: "user", content: "Old message 11" },
        { role: "user", content: "Newer message 12" },
        { role: "user", content: "Newest message 13" },
      ] as AgentMessage[];

      const result = compactMessagesTokenAware(messages, 50, {
        targetRatio: 0.5,
        minKeepMessages: 3,
      });

      if (result) {
        // Should keep the newest messages
        const lastKept = result.kept[result.kept.length - 1];
        expect((lastKept as any).content).toContain("Newest");
      }
    });

    it("should use default options when not specified", () => {
      const messages = createMessages(15);
      const result = compactMessagesTokenAware(messages, 100);
      // Should use default targetRatio (0.5) and minKeepMessages (10)
      if (result) {
        expect(result.kept.length).toBeGreaterThanOrEqual(MIN_KEEP_MESSAGES);
      }
    });
  });

  describe("isMessageOversized", () => {
    it("should return true for oversized message", () => {
      const message = {
        role: "user",
        content: "x".repeat(4000), // ~1000 tokens
      } as AgentMessage;

      // With default maxRatio 0.5, 1000 tokens in 1000 context = 100% > 50%
      expect(isMessageOversized(message, 1000)).toBe(true);
    });

    it("should return false for small message", () => {
      const message = {
        role: "user",
        content: "Hello", // ~2 tokens
      } as AgentMessage;

      expect(isMessageOversized(message, 10000)).toBe(false);
    });

    it("should use custom maxRatio", () => {
      const message = {
        role: "user",
        content: "x".repeat(400), // ~100 tokens
      } as AgentMessage;

      // With safety margin 1.5, 100 * 1.5 = 150 tokens
      // 150 > 1000 * 0.1 = 100, so oversized
      expect(isMessageOversized(message, 1000, 0.1)).toBe(true);

      // 150 < 1000 * 0.2 = 200, so not oversized
      expect(isMessageOversized(message, 1000, 0.2)).toBe(false);
    });

    it("should apply safety margin to token count", () => {
      const message = {
        role: "user",
        content: "x".repeat(400), // ~100 tokens, with margin ~150
      } as AgentMessage;

      // Without margin: 100 < 250 (50% of 500)
      // With margin: 150 < 250, still ok
      expect(isMessageOversized(message, 500, 0.5)).toBe(false);

      // Without margin: 100 < 100 would be false
      // With margin: 150 > 100, should be true
      expect(isMessageOversized(message, 200, 0.5)).toBe(true);
    });
  });
});
