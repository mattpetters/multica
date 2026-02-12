/**
 * Token estimation tool
 *
 * Provides token counting functionality for messages and system prompts
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { estimateTokens } from "@mariozechner/pi-coding-agent";
import type { TokenEstimation, TokenAwareCompactionResult } from "./types.js";

/** Safety margin coefficient to compensate for estimation inaccuracy */
export const ESTIMATION_SAFETY_MARGIN = 1.5; // 50% buffer (covers CJK and mixed content)

/** Utilization threshold for triggering compaction */
export const COMPACTION_TRIGGER_RATIO = 0.8; // 80%

/** Compaction target utilization ratio */
export const COMPACTION_TARGET_RATIO = 0.5; // 50%

/** Minimum messages to keep */
export const MIN_KEEP_MESSAGES = 10;

/**
 * Estimate total tokens for message array
 */
export function estimateMessagesTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

/**
 * Estimate tokens for system prompt
 */
export function estimateSystemPromptTokens(systemPrompt: string | undefined): number {
  if (!systemPrompt) return 0;
  // Conservative estimation: ~2 chars = 1 token
  // English/code averages ~4 chars/token but CJK averages ~1-2 chars/token.
  // Using /2 as a safe default to prevent underestimation on mixed content.
  return Math.ceil(systemPrompt.length / 2);
}

/**
 * Calculate complete token usage
 */
export function estimateTokenUsage(params: {
  messages: AgentMessage[];
  systemPrompt?: string | undefined;
  contextWindowTokens: number;
  reserveTokens?: number | undefined;
}): TokenEstimation {
  const messageTokens = estimateMessagesTokens(params.messages);
  const systemPromptTokens = estimateSystemPromptTokens(params.systemPrompt);
  const reserve = params.reserveTokens ?? 1024; // Reserved for response generation

  // Available tokens = total window - system prompt - reserve
  const availableTokens = Math.max(
    0,
    params.contextWindowTokens - systemPromptTokens - reserve,
  );

  // Calculate utilization ratio (with safety margin)
  const safeMessageTokens = messageTokens * ESTIMATION_SAFETY_MARGIN;
  const utilizationRatio = availableTokens > 0 ? safeMessageTokens / availableTokens : 1;

  return {
    messageTokens,
    systemPromptTokens,
    availableTokens,
    utilizationRatio,
  };
}

/**
 * Determine if compaction is needed
 */
export function shouldCompact(estimation: TokenEstimation): boolean {
  return estimation.utilizationRatio >= COMPACTION_TRIGGER_RATIO;
}

/**
 * Token-aware message compression
 *
 * Strategy: Remove from oldest messages until reaching target utilization ratio
 */
export function compactMessagesTokenAware(
  messages: AgentMessage[],
  availableTokens: number,
  options?: {
    targetRatio?: number;
    minKeepMessages?: number;
  },
): TokenAwareCompactionResult | null {
  const targetRatio = options?.targetRatio ?? COMPACTION_TARGET_RATIO;
  const minKeep = options?.minKeepMessages ?? MIN_KEEP_MESSAGES;

  if (messages.length <= minKeep) {
    return null; // Too few messages, no compression
  }

  const currentTokens = estimateMessagesTokens(messages);
  const targetTokens = Math.floor(availableTokens * targetRatio);

  // If already within target, no compression needed
  if (currentTokens <= targetTokens) {
    return null;
  }

  // Keep messages from back to front until reaching target token count
  const kept: AgentMessage[] = [];
  let keptTokens = 0;

  // Reverse iteration, keep newest messages
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const msgTokens = estimateTokens(msg);

    // Check if this message can be added
    if (keptTokens + msgTokens <= targetTokens || kept.length < minKeep) {
      kept.unshift(msg);
      keptTokens += msgTokens;
    }

    // If minimum keep count reached and exceeds target, stop
    if (kept.length >= minKeep && keptTokens >= targetTokens) {
      break;
    }
  }

  // If kept message count unchanged, no compression occurred
  if (kept.length >= messages.length) {
    return null;
  }

  const removedCount = messages.length - kept.length;
  const tokensRemoved = currentTokens - keptTokens;

  return {
    kept,
    removedCount,
    tokensRemoved,
    tokensKept: keptTokens,
  };
}

/**
 * Check if single message is oversized
 *
 * If a single message exceeds a certain ratio of context window, special handling may be needed
 */
export function isMessageOversized(
  message: AgentMessage,
  contextWindowTokens: number,
  maxRatio: number = 0.5,
): boolean {
  const tokens = estimateTokens(message) * ESTIMATION_SAFETY_MARGIN;
  return tokens > contextWindowTokens * maxRatio;
}
