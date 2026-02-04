/**
 * Hub IPC handlers for Electron main process.
 *
 * Creates and manages a Hub instance that connects to the Gateway.
 * This follows the same pattern as the Console app.
 */
import { ipcMain } from 'electron'
import { Hub } from '../../../../src/hub/hub.js'
import type { ConnectionState } from '@multica/sdk'
import type { AsyncAgent } from '../../../../src/agent/async-agent.js'

// Singleton Hub instance
let hub: Hub | null = null
let defaultAgentId: string | null = null

/**
 * Initialize Hub on app startup.
 * Creates Hub and a default Agent automatically.
 */
export async function initializeHub(): Promise<void> {
  if (hub) {
    console.log('[Desktop] Hub already initialized')
    return
  }

  const gatewayUrl = process.env['GATEWAY_URL'] ?? 'http://localhost:3000'
  console.log(`[Desktop] Initializing Hub, connecting to Gateway: ${gatewayUrl}`)

  hub = new Hub(gatewayUrl)

  // Create default agent if none exists
  const agents = hub.listAgents()
  if (agents.length === 0) {
    console.log('[Desktop] Creating default agent...')
    const agent = hub.createAgent()
    defaultAgentId = agent.sessionId
    console.log(`[Desktop] Default agent created: ${defaultAgentId}`)
  } else {
    defaultAgentId = agents[0]
    console.log(`[Desktop] Using existing agent: ${defaultAgentId}`)
  }
}

/**
 * Get or create the Hub instance.
 */
function getHub(): Hub {
  if (!hub) {
    const gatewayUrl = process.env['GATEWAY_URL'] ?? 'http://localhost:3000'
    console.log(`[Desktop] Creating Hub, connecting to Gateway: ${gatewayUrl}`)
    hub = new Hub(gatewayUrl)
  }
  return hub
}

/**
 * Get the default agent.
 */
function getDefaultAgent(): AsyncAgent | null {
  if (!hub || !defaultAgentId) return null
  return hub.getAgent(defaultAgentId) ?? null
}

/**
 * Hub info returned to renderer.
 */
export interface HubInfo {
  hubId: string
  url: string
  connectionState: ConnectionState
  agentCount: number
}

/**
 * Agent info returned to renderer.
 */
export interface AgentInfo {
  id: string
  closed: boolean
}

/**
 * Register all Hub-related IPC handlers.
 */
export function registerHubIpcHandlers(): void {
  /**
   * Initialize the Hub (creates singleton if not exists).
   */
  ipcMain.handle('hub:init', async () => {
    await initializeHub()
    const h = getHub()
    return {
      hubId: h.hubId,
      url: h.url,
      connectionState: h.connectionState,
      defaultAgentId,
    }
  })

  /**
   * Get Hub status info.
   */
  ipcMain.handle('hub:info', async (): Promise<HubInfo> => {
    const h = getHub()
    return {
      hubId: h.hubId,
      url: h.url,
      connectionState: h.connectionState,
      agentCount: h.listAgents().length,
    }
  })

  /**
   * Get Hub status with default agent info (for home page).
   */
  ipcMain.handle('hub:getStatus', async () => {
    const h = getHub()
    const agent = getDefaultAgent()

    return {
      hubId: h.hubId,
      status: h.connectionState === 'connected' ? 'ready' : h.connectionState,
      agentCount: h.listAgents().length,
      gatewayConnected: h.connectionState === 'connected',
      gatewayUrl: h.url,
      defaultAgent: agent
        ? {
            agentId: agent.sessionId,
            status: agent.closed ? 'closed' : 'idle',
          }
        : null,
    }
  })

  /**
   * Get default agent info.
   */
  ipcMain.handle('hub:getAgentInfo', async () => {
    const agent = getDefaultAgent()
    if (!agent) {
      return null
    }
    return {
      agentId: agent.sessionId,
      status: agent.closed ? 'closed' : 'idle',
    }
  })

  /**
   * Reconnect Hub to a different Gateway URL.
   */
  ipcMain.handle('hub:reconnect', async (_event, url: string) => {
    const h = getHub()
    h.reconnect(url)
    return { url: h.url }
  })

  /**
   * List all agents.
   */
  ipcMain.handle('hub:listAgents', async (): Promise<AgentInfo[]> => {
    const h = getHub()
    const agentIds = h.listAgents()
    return agentIds.map((id) => {
      const agent = h.getAgent(id)
      return {
        id,
        closed: agent?.closed ?? true,
      }
    })
  })

  /**
   * Create a new agent.
   */
  ipcMain.handle('hub:createAgent', async (_event, id?: string) => {
    const h = getHub()
    const agent = h.createAgent(id)
    return {
      id: agent.sessionId,
      closed: agent.closed,
    }
  })

  /**
   * Get a specific agent.
   */
  ipcMain.handle('hub:getAgent', async (_event, id: string) => {
    const h = getHub()
    const agent = h.getAgent(id)
    if (!agent) {
      return { error: `Agent not found: ${id}` }
    }
    return {
      id: agent.sessionId,
      closed: agent.closed,
    }
  })

  /**
   * Close/delete an agent.
   */
  ipcMain.handle('hub:closeAgent', async (_event, id: string) => {
    const h = getHub()
    const result = h.closeAgent(id)
    return { ok: result }
  })

  /**
   * Send a message to an agent.
   */
  ipcMain.handle('hub:sendMessage', async (_event, agentId: string, content: string) => {
    const h = getHub()
    const agent = h.getAgent(agentId)
    if (!agent) {
      return { error: `Agent not found: ${agentId}` }
    }
    if (agent.closed) {
      return { error: `Agent is closed: ${agentId}` }
    }
    agent.write(content)
    return { ok: true }
  })

  /**
   * Register a one-time token for device verification.
   * Called by the QR code component when a token is generated or refreshed.
   */
  ipcMain.handle('hub:registerToken', async (_event, token: string, agentId: string, expiresAt: number) => {
    const h = getHub()
    h.registerToken(token, agentId, expiresAt)
    return { ok: true }
  })

  /**
   * List all verified (whitelisted) devices.
   */
  ipcMain.handle('hub:listDevices', async () => {
    const h = getHub()
    return h.deviceStore.listDevices()
  })

  /**
   * Revoke a device from the whitelist.
   */
  ipcMain.handle('hub:revokeDevice', async (_event, deviceId: string) => {
    const h = getHub()
    return { ok: h.deviceStore.revokeDevice(deviceId) }
  })

}

/**
 * Set up device confirmation flow between Hub (main process) and renderer.
 * Must be called after both Hub initialization and window creation.
 */
export function setupDeviceConfirmation(mainWindow: Electron.BrowserWindow): void {
  const h = getHub()
  const pendingConfirms = new Map<string, (allowed: boolean) => void>()

  // Listen for renderer responses to device confirm dialogs
  ipcMain.on('hub:device-confirm-response', (_event, deviceId: string, allowed: boolean) => {
    const resolve = pendingConfirms.get(deviceId)
    if (resolve) {
      pendingConfirms.delete(deviceId)
      resolve(allowed)
    }
  })

  // Register confirm handler on Hub — sends request to renderer, awaits response
  h.setConfirmHandler((deviceId: string, _agentId: string, meta) => {
    return new Promise<boolean>((resolve) => {
      // Auto-reject if user doesn't respond within 60 seconds
      const timeout = setTimeout(() => {
        pendingConfirms.delete(deviceId)
        resolve(false)
      }, 60_000)
      pendingConfirms.set(deviceId, (allowed: boolean) => {
        clearTimeout(timeout)
        resolve(allowed)
      })
      mainWindow.webContents.send('hub:device-confirm-request', deviceId, meta)
    })
  })
}

/**
 * Cleanup Hub resources.
 */
export function cleanupHub(): void {
  if (hub) {
    console.log('[Desktop] Shutting down Hub')
    hub.shutdown()
    hub = null
  }
}

/**
 * Get the current Hub instance (for use by other IPC modules).
 */
export function getCurrentHub(): Hub | null {
  return hub
}
