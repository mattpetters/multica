/**
 * Connection Store - manages WebSocket connection lifecycle
 *
 * Responsibilities:
 *   1. Persist deviceId (auto-generated on first run, restored from localStorage)
 *   2. Establish WebSocket connection to Gateway using connection code (from QR/paste)
 *   3. Maintain connection state (disconnected → connecting → connected → registered)
 *   4. Route incoming stream messages from Hub to MessagesStore
 *   5. Provide send() for MessagesStore to send messages
 *
 * Data flow:
 *   connection code → connect() → GatewayClient(Socket.io) → Gateway server
 *                                                               ↓
 *                                               onMessage callback → MessagesStore
 */
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { v7 as uuidv7 } from "uuid"
import {
  GatewayClient,
  StreamAction,
  extractTextFromEvent,
  type ConnectionState,
  type SendErrorResponse,
  type StreamPayload,
  type StreamMessageEvent,
} from "@multica/sdk"
import { useMessagesStore } from "./messages"
import { clearConnection, type ConnectionInfo } from "./connection"

interface ConnectionStoreState {
  deviceId: string
  gatewayUrl: string | null
  hubId: string | null
  agentId: string | null
  connectionState: ConnectionState
  lastError: SendErrorResponse | null
}

interface ConnectionStoreActions {
  connect: (code: ConnectionInfo) => void
  disconnect: () => void
  send: (to: string, action: string, payload: unknown) => void
}

export type ConnectionStore = ConnectionStoreState & ConnectionStoreActions

// Module-level singleton — only one WebSocket connection per app
let client: GatewayClient | null = null

/**
 * Create a GatewayClient and bind message-handling callbacks.
 *
 * GatewayClient is defined in packages/sdk/src/client.ts
 * It wraps Socket.io and exposes:
 *   - connect()                          establish WebSocket connection
 *   - disconnect()                       tear down connection
 *   - send(to, action, payload)          send message to a specific device
 *   - request(to, method, params)        send RPC request and await response
 *   - onStateChange(cb)                  listen for connection state changes
 *   - onMessage(cb)                      listen for incoming messages
 *   - onSendError(cb)                    listen for send failures
 *   - isRegistered / isConnected         connection state checks
 *
 * Connection requires two params:
 *   - url: Gateway server address (from connection code's gateway field)
 *   - deviceId: unique device identifier (persisted in this store)
 *
 * Sending messages requires two routing params:
 *   - hubId: which Hub to send to (from connection code)
 *   - agentId: which Agent within the Hub (from connection code)
 */
function createClient(
  url: string,
  deviceId: string,
  set: (s: Partial<ConnectionStoreState>) => void,
  getState: () => ConnectionStoreState,
): GatewayClient {
  return new GatewayClient({
    url,
    deviceId,
    deviceType: "client",
  })
    // Sync connection state changes to the store
    .onStateChange((connectionState) => {
      set({ connectionState })
      // Fetch message history after successful registration
      if (connectionState === "registered") {
        void fetchHistory(getState())
      }
    })
    // Route incoming messages to MessagesStore
    .onMessage((msg) => {
      // Streaming messages: Agent replies arrive in chunks
      if (msg.action === StreamAction) {
        const payload = msg.payload as StreamPayload
        const store = useMessagesStore.getState()
        const { event } = payload

        switch (event.type) {
          case "message_start": {
            store.startStream(payload.streamId, payload.agentId)
            const text = extractTextFromEvent(event as StreamMessageEvent)
            if (text) store.appendStream(payload.streamId, text)
            break
          }
          case "message_update": {
            const text = extractTextFromEvent(event as StreamMessageEvent)
            store.appendStream(payload.streamId, text)
            break
          }
          case "message_end": {
            const text = extractTextFromEvent(event as StreamMessageEvent)
            store.endStream(payload.streamId, text)
            break
          }
          case "tool_execution_start":
          case "tool_execution_end":
            break
        }
        return
      }

      // Handle direct (non-streaming) messages
      const payload = msg.payload as { agentId?: string; content?: string }
      if (payload?.agentId && payload?.content) {
        useMessagesStore.getState().addAssistantMessage(payload.content, payload.agentId)
      }
    })
    .onSendError((error) => set({ lastError: error }))
}

/** Fetch message history from Hub via RPC after connection is established */
async function fetchHistory(state: ConnectionStoreState): Promise<void> {
  const { hubId, agentId } = state
  if (!client || !hubId || !agentId) return

  try {
    const result = await client.request<{
      messages: Array<{ role: string; content: unknown }>
      total: number
    }>(hubId, "getAgentMessages", { agentId, limit: 200 })

    const messages = result.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: uuidv7(),
        role: m.role as "user" | "assistant",
        content: extractText(m.content),
        agentId: agentId,
      }))
      .filter((m) => m.content.length > 0)

    if (messages.length > 0) {
      useMessagesStore.getState().loadMessages(messages)
    }
  } catch {
    // History fetch is best-effort — connection still works without it
  }
}

/** Extract plain text from AgentMessage content (string or content block array) */
function extractText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((c: { type?: string }) => c.type === "text")
    .map((c: { text?: string }) => c.text ?? "")
    .join("")
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set, get) => ({
      deviceId: uuidv7(),
      gatewayUrl: null,
      hubId: null,
      agentId: null,
      connectionState: "disconnected",
      lastError: null,

      // Connect using a connection code (disconnect existing connection first)
      connect: (code) => {
        if (client) {
          client.disconnect()
          client = null
        }

        set({
          gatewayUrl: code.gateway,
          hubId: code.hubId,
          agentId: code.agentId,
        })

        client = createClient(code.gateway, get().deviceId, set, get)
        client.connect()
      },

      // Disconnect and clear all state (messages + saved connection code)
      disconnect: () => {
        if (client) {
          client.disconnect()
          client = null
        }
        useMessagesStore.getState().clearMessages()
        clearConnection()
        set({
          connectionState: "disconnected",
          gatewayUrl: null,
          hubId: null,
          agentId: null,
          lastError: null,
        })
      },

      // Send a message to a target device (called by MessagesStore.sendMessage)
      send: (to, action, payload) => {
        if (!client?.isRegistered) return
        client.send(to, action, payload)
      },
    }),
    {
      name: "multica-device",
      // Only persist deviceId — other fields are runtime state
      partialize: (state) => ({ deviceId: state.deviceId }),
    },
  ),
)
