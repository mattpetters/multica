import type { AgentMessage } from "@mariozechner/pi-agent-core";

/** Extract plain text content from an AgentMessage */
export function extractText(message: AgentMessage | undefined): string {
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content = (message as { content?: Array<{ type: string; text?: string }> }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

/** Check if an AgentMessage contains tool_use blocks (i.e., is a tool invocation, not a final answer) */
export function hasToolUse(message: AgentMessage | undefined): boolean {
  if (!message || typeof message !== "object" || !("content" in message)) return false;
  const content = (message as { content?: Array<{ type: string }> }).content;
  if (!Array.isArray(content)) return false;
  return content.some((c) => c.type === "toolCall" || c.type === "tool_use");
}

/** Extract thinking/reasoning content from an AgentMessage */
export function extractThinking(message: AgentMessage | undefined): string {
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content = (message as { content?: Array<{ type: string; thinking?: string }> }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "thinking")
    .map((c) => c.thinking ?? "")
    .join("");
}
