import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../shared/index.js";

// ============ Types ============

interface TokenEntry {
  token: string;
  agentId: string;
  expiresAt: number;
}

export interface DeviceMeta {
  userAgent?: string;
  platform?: string;
  language?: string;
}

export interface DeviceEntry {
  deviceId: string;
  agentId: string;
  addedAt: number;
  meta?: DeviceMeta;
}

// ============ Persistence ============

const DEVICES_DIR = join(DATA_DIR, "devices");
const DEVICES_FILE = join(DEVICES_DIR, "whitelist.json");

function ensureDir(): void {
  if (!existsSync(DEVICES_DIR)) {
    mkdirSync(DEVICES_DIR, { recursive: true });
  }
}

function loadDevices(): DeviceEntry[] {
  if (!existsSync(DEVICES_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DEVICES_FILE, "utf-8")) as DeviceEntry[];
  } catch {
    return [];
  }
}

function saveDevices(devices: DeviceEntry[]): void {
  ensureDir();
  writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2), "utf-8");
}

// ============ DeviceStore ============

export class DeviceStore {
  /** One-time tokens (in-memory only, not persisted) */
  private readonly tokens = new Map<string, TokenEntry>();
  /** Allowed device IDs (persisted to disk) */
  private readonly allowedDevices = new Map<string, DeviceEntry>();

  constructor() {
    // Restore from persistent storage
    for (const entry of loadDevices()) {
      this.allowedDevices.set(entry.deviceId, entry);
    }
  }

  // ---- Token management ----

  /** Register a one-time token (called when QR code is generated) */
  registerToken(token: string, agentId: string, expiresAt: number): void {
    // Clean up expired tokens to prevent accumulation
    const now = Date.now();
    for (const [key, entry] of this.tokens) {
      if (now > entry.expiresAt) this.tokens.delete(key);
    }
    this.tokens.set(token, { token, agentId, expiresAt });
  }

  /** Validate and consume a token (one-time use). Returns agentId if valid, null otherwise. */
  consumeToken(token: string): { agentId: string } | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    // Always delete — consumed or expired
    this.tokens.delete(token);
    if (Date.now() > entry.expiresAt) return null;
    return { agentId: entry.agentId };
  }

  // ---- Device whitelist ----

  /** Add a device to the whitelist (called after token verification + user confirmation) */
  allowDevice(deviceId: string, agentId: string, meta?: DeviceMeta): void {
    const entry: DeviceEntry = { deviceId, agentId, addedAt: Date.now(), meta };
    this.allowedDevices.set(deviceId, entry);
    this.persist();
  }

  /** Check if a device is in the whitelist */
  isAllowed(deviceId: string): { agentId: string } | null {
    const entry = this.allowedDevices.get(deviceId);
    return entry ? { agentId: entry.agentId } : null;
  }

  /** Remove a device from the whitelist */
  revokeDevice(deviceId: string): boolean {
    const deleted = this.allowedDevices.delete(deviceId);
    if (deleted) this.persist();
    return deleted;
  }

  /** List all whitelisted devices */
  listDevices(): DeviceEntry[] {
    return Array.from(this.allowedDevices.values());
  }

  private persist(): void {
    saveDevices(Array.from(this.allowedDevices.values()));
  }
}
