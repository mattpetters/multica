/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// ============================================================================
// ElectronAPI type definitions
// ============================================================================

interface HubStatus {
  hubId: string
  status: string
  agentCount: number
  gatewayConnected: boolean
  gatewayUrl?: string
  defaultAgent?: {
    agentId: string
    status: string
  } | null
}

interface AgentInfo {
  agentId: string
  status: string
}

interface ToolInfo {
  name: string
  group: string
  enabled: boolean
}

interface SkillInfo {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  source: 'bundled' | 'global' | 'profile'
  triggers: string[]
}

interface DeviceMeta {
  userAgent?: string
  platform?: string
  language?: string
}

interface DeviceEntryInfo {
  deviceId: string
  agentId: string
  addedAt: number
  meta?: DeviceMeta
}

interface SkillAddResult {
  ok: boolean
  message: string
  path?: string
  skills?: string[]
}

interface ElectronAPI {
  hub: {
    init: () => Promise<unknown>
    getStatus: () => Promise<HubStatus>
    getAgentInfo: () => Promise<AgentInfo | null>
    info: () => Promise<unknown>
    reconnect: (url: string) => Promise<unknown>
    listAgents: () => Promise<unknown>
    createAgent: (id?: string) => Promise<unknown>
    getAgent: (id: string) => Promise<unknown>
    closeAgent: (id: string) => Promise<unknown>
    sendMessage: (agentId: string, content: string) => Promise<unknown>
    registerToken: (token: string, agentId: string, expiresAt: number) => Promise<unknown>
    onDeviceConfirmRequest: (callback: (deviceId: string, meta?: DeviceMeta) => void) => void
    offDeviceConfirmRequest: () => void
    deviceConfirmResponse: (deviceId: string, allowed: boolean) => void
    listDevices: () => Promise<DeviceEntryInfo[]>
    revokeDevice: (deviceId: string) => Promise<{ ok: boolean }>
  }
  tools: {
    list: () => Promise<ToolInfo[]>
    toggle: (name: string) => Promise<unknown>
    setStatus: (name: string, enabled: boolean) => Promise<unknown>
    active: () => Promise<unknown>
    reload: () => Promise<unknown>
  }
  skills: {
    list: () => Promise<SkillInfo[]>
    get: (id: string) => Promise<unknown>
    toggle: (id: string) => Promise<unknown>
    setStatus: (id: string, enabled: boolean) => Promise<unknown>
    reload: () => Promise<unknown>
    add: (source: string, options?: { name?: string; force?: boolean }) => Promise<SkillAddResult>
    remove: (name: string) => Promise<SkillAddResult>
  }
  agent: {
    status: () => Promise<unknown>
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer
  electronAPI: ElectronAPI
}
