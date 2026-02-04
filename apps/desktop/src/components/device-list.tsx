import { useState } from 'react'
import { Button } from '@multica/ui/components/ui/button'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  SmartPhone01Icon,
  Delete02Icon,
  Loading03Icon,
  RotateClockwiseIcon,
} from '@hugeicons/core-free-icons'
import { useDevices, type DeviceEntry } from '../hooks/use-devices'
import { parseUserAgent } from '../lib/parse-user-agent'

// ============ Relative Time ============

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

// ============ Component ============

function DeviceItem({
  device,
  onRevoke,
}: {
  device: DeviceEntry
  onRevoke: (deviceId: string) => Promise<boolean>
}) {
  const [revoking, setRevoking] = useState(false)

  const parsed = device.meta?.userAgent
    ? parseUserAgent(device.meta.userAgent)
    : null

  const displayName = parsed
    ? `${parsed.browser} on ${parsed.os}`
    : device.deviceId

  const handleRevoke = async () => {
    setRevoking(true)
    try {
      await onRevoke(device.deviceId)
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <HugeiconsIcon icon={SmartPhone01Icon} className="size-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{displayName}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono truncate max-w-[180px]">{device.deviceId}</span>
            <span>·</span>
            <span>{relativeTime(device.addedAt)}</span>
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive shrink-0"
        onClick={handleRevoke}
        disabled={revoking}
      >
        {revoking ? (
          <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
        ) : (
          <HugeiconsIcon icon={Delete02Icon} className="size-4" />
        )}
      </Button>
    </div>
  )
}

export function DeviceList() {
  const { devices, loading, refresh, revokeDevice } = useDevices()

  if (loading) {
    return null
  }

  if (devices.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          Verified Devices ({devices.length})
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={refresh}
        >
          <HugeiconsIcon icon={RotateClockwiseIcon} className="size-3" />
          Refresh
        </Button>
      </div>
      <div className="border rounded-lg divide-y overflow-hidden">
        {devices.map((device) => (
          <DeviceItem
            key={device.deviceId}
            device={device}
            onRevoke={revokeDevice}
          />
        ))}
      </div>
    </div>
  )
}
