/**
 * Messages Store - manages chat messages and streaming state for the current Agent
 *
 * Responsibilities:
 *   1. Store current Agent's chat messages (replaced on Agent switch, not accumulated)
 *   2. Manage streaming state (intermediate state while AI replies arrive in chunks)
 *   3. Provide sendMessage() as the single entry point for sending messages
 *
 * Send flow:
 *   user input → sendMessage(text)
 *     → addUserMessage() immediately adds to local state (optimistic update)
 *     → ConnectionStore.send() sends to Gateway → Hub → Agent
 *
 * Receive flow (driven by ConnectionStore's onMessage callback):
 *   Streaming: startStream → appendStream (repeated) → endStream
 *   Non-streaming: addAssistantMessage (one-shot)
 */
import { create } from "zustand"
import { v7 as uuidv7 } from "uuid"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  agentId: string
}

/** Parameters needed to route a message through the gateway */
export interface SendContext {
  hubId: string
  agentId: string
  send: (to: string, action: string, payload: unknown) => void
}

interface MessagesState {
  messages: Message[]
  streamingIds: Set<string>
}

interface MessagesActions {
  sendMessage: (text: string, ctx: SendContext) => void
  addUserMessage: (content: string, agentId: string) => void
  addAssistantMessage: (content: string, agentId: string) => void
  updateMessage: (id: string, content: string) => void
  // Replace all messages (for Agent switch or loading history)
  loadMessages: (msgs: Message[]) => void
  clearMessages: () => void
  startStream: (streamId: string, agentId: string) => void
  appendStream: (streamId: string, content: string) => void
  endStream: (streamId: string, content: string) => void
}

export type MessagesStore = MessagesState & MessagesActions

export const useMessagesStore = create<MessagesStore>()((set, get) => ({
  messages: [],
  streamingIds: new Set<string>(),

  // Single entry point for sending: optimistic local add, then send via WebSocket
  sendMessage: (text, ctx) => {
    get().addUserMessage(text, ctx.agentId)
    ctx.send(ctx.hubId, "message", { agentId: ctx.agentId, content: text })
  },

  addUserMessage: (content, agentId) => {
    set((s) => ({
      messages: [...s.messages, { id: uuidv7(), role: "user", content, agentId }],
    }))
  },

  addAssistantMessage: (content, agentId) => {
    set((s) => ({
      messages: [...s.messages, { id: uuidv7(), role: "assistant", content, agentId }],
    }))
  },

  updateMessage: (id, content) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)),
    }))
  },

  // Replace all messages (for Agent switch or loading history)
  loadMessages: (msgs) => {
    set({ messages: msgs })
  },

  clearMessages: () => {
    set({ messages: [], streamingIds: new Set() })
  },

  // === The following three methods are called by ConnectionStore's onMessage callback ===
  // Stream start: create an empty placeholder message and mark as streaming
  startStream: (streamId, agentId) => {
    set((s) => {
      const ids = new Set(s.streamingIds)
      ids.add(streamId)
      return {
        messages: [...s.messages, { id: streamId, role: "assistant" as const, content: "", agentId }],
        streamingIds: ids,
      }
    })
  },

  // Stream update: replace message content (each update carries the full accumulated text)
  appendStream: (streamId, content) => {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === streamId ? { ...m, content } : m)),
    }))
  },

  // Stream end: write final content, remove streaming marker
  endStream: (streamId, content) => {
    set((s) => {
      const ids = new Set(s.streamingIds)
      ids.delete(streamId)
      return {
        messages: s.messages.map((m) => (m.id === streamId ? { ...m, content } : m)),
        streamingIds: ids,
      }
    })
  },
}))
