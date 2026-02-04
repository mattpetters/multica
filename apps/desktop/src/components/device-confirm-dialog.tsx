import { useState, useEffect, useCallback } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@multica/ui/components/ui/alert-dialog'
import { parseUserAgent } from '../lib/parse-user-agent'

interface DeviceMeta {
  userAgent?: string
  platform?: string
  language?: string
}

interface PendingConfirm {
  deviceId: string
  meta?: DeviceMeta
}

/**
 * Device confirmation dialog — shown when a new device tries to connect via QR code.
 * Listens for 'hub:device-confirm-request' IPC events from the main process,
 * shows an AlertDialog, and sends the user's response back.
 */
export function DeviceConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  useEffect(() => {
    window.electronAPI?.hub.onDeviceConfirmRequest((deviceId: string, meta?: DeviceMeta) => {
      setPending({ deviceId, meta })
    })
    return () => {
      window.electronAPI?.hub.offDeviceConfirmRequest()
    }
  }, [])

  const handleAllow = useCallback(() => {
    if (!pending) return
    window.electronAPI?.hub.deviceConfirmResponse(pending.deviceId, true)
    setPending(null)
  }, [pending])

  const handleReject = useCallback(() => {
    if (!pending) return
    window.electronAPI?.hub.deviceConfirmResponse(pending.deviceId, false)
    setPending(null)
  }, [pending])

  const parsed = pending?.meta?.userAgent
    ? parseUserAgent(pending.meta.userAgent)
    : null

  const deviceLabel = parsed
    ? `${parsed.browser} on ${parsed.os}`
    : pending?.deviceId

  return (
    <AlertDialog open={pending !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>New Device Connection</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <span className="font-medium">{deviceLabel}</span> wants to connect.
              </p>
              {parsed && (
                <p className="text-xs font-mono text-muted-foreground truncate">
                  {pending?.deviceId}
                </p>
              )}
              <p>Allow this device?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleReject}>
            Reject
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleAllow}>
            Allow
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
