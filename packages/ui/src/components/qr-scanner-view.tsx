"use client"

import "./qr-scanner.css"

import { useState, useCallback, useRef, useEffect } from "react"
import { useQrScanner } from "@multica/ui/hooks/use-qr-scanner"
import { Spinner } from "@multica/ui/components/spinner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Camera01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  FlashlightIcon,
} from "@hugeicons/core-free-icons"

type ScannerState =
  | "idle"
  | "requesting"
  | "scanning"
  | "detected"
  | "success"
  | "error"

export interface QrScannerProps {
  onResult: (data: string) => Promise<void>
  onClose?: () => void
  open?: boolean
  /** When true, scanning state renders as a fullscreen overlay (mobile). */
  fullscreen?: boolean
}

const ACTIVE_STATES: ScannerState[] = [
  "requesting",
  "scanning",
  "detected",
  "success",
  "error",
]

export function QrScannerView({
  onResult,
  onClose,
  open,
  fullscreen = false,
}: QrScannerProps) {
  const [state, setState] = useState<ScannerState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const startRef = useRef<(() => Promise<void>) | null>(null)

  const handleScan = useCallback(
    (data: string) => {
      if (stateRef.current !== "scanning") return

      setState("detected")
      navigator.vibrate?.(50)

      setTimeout(async () => {
        try {
          await onResult(data)
          setState("success")
          navigator.vibrate?.(50)
        } catch (e) {
          setErrorMessage((e as Error).message || "Invalid code")
          setState("error")
          navigator.vibrate?.([30, 50, 30])
          setTimeout(() => {
            setErrorMessage(null)
            setState("scanning")
            startRef.current?.()
          }, 3000)
        }
      }, 200)
    },
    [onResult],
  )

  const {
    videoRef,
    hasCamera,
    hasFlash,
    toggleFlash,
    start: scannerStart,
    stop: scannerStop,
    pause: scannerPause,
  } = useQrScanner({
    onScan: handleScan,
    enabled: false,
  })

  startRef.current = scannerStart

  useEffect(() => {
    if (state === "detected" || state === "success") {
      scannerPause()
    }
  }, [state, scannerPause])

  useEffect(() => {
    if (open === false) {
      scannerStop()
      setState("idle")
      setErrorMessage(null)
    }
  }, [open, scannerStop])

  useEffect(() => {
    return () => scannerStop()
  }, [scannerStop])

  // Double-rAF: wait for video element to mount before starting scanner
  useEffect(() => {
    if (state !== "requesting") return
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        try {
          await scannerStart()
          setState("scanning")
        } catch {
          setState("idle")
        }
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [state, scannerStart])

  const handleStart = useCallback(async () => {
    try {
      const perm = await navigator.permissions?.query({
        name: "camera" as PermissionName,
      })
      if (perm?.state === "denied") {
        setErrorMessage(
          "Camera access denied. Please enable it in your browser settings.",
        )
        onClose?.()
        return
      }
    } catch {
      // Safari doesn't support camera permission query
    }
    setState("requesting")
  }, [onClose])

  const handleClose = useCallback(() => {
    scannerStop()
    setState("idle")
    setErrorMessage(null)
  }, [scannerStop])

  if (!hasCamera) {
    return (
      <div className="flex items-center justify-center h-[320px] rounded-xl bg-muted">
        <p className="text-sm text-muted-foreground">No camera available</p>
      </div>
    )
  }

  const isActive = ACTIVE_STATES.includes(state)

  const bracketColor =
    state === "success"
      ? "border-[color:var(--tool-success)]"
      : state === "error"
        ? "border-[color:var(--tool-error)]"
        : state === "detected"
          ? "border-primary"
          : "border-white/30"

  const bracketAnimation =
    state === "scanning"
      ? "animate-scan-breathe"
      : state === "error"
        ? "animate-scan-shake"
        : ""

  const viewfinder = (
    <div
      className={
        fullscreen && isActive
          ? "relative w-full h-full"
          : "relative aspect-square rounded-xl overflow-hidden bg-muted"
      }
    >
      {/* Video — only mounted after idle */}
      {state !== "idle" && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Idle */}
      {state === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleStart}
            className="flex items-center justify-center size-16 rounded-full bg-foreground/10 hover:bg-foreground/20 transition-colors"
          >
            <HugeiconsIcon
              icon={Camera01Icon}
              className="size-7 text-muted-foreground"
            />
          </button>
          <p className="text-xs text-muted-foreground">Tap to open camera</p>
        </div>
      )}

      {/* Requesting */}
      {state === "requesting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Spinner className="text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Requesting camera...
          </p>
        </div>
      )}

      {/* Fixed centered brackets — always same position, color changes per state */}
      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={`relative w-3/4 h-3/4 max-w-[280px] max-h-[280px] ${bracketAnimation}`}
          >
            <div
              className={`absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 ${bracketColor} rounded-tl-md transition-colors duration-200`}
            />
            <div
              className={`absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 ${bracketColor} rounded-tr-md transition-colors duration-200`}
            />
            <div
              className={`absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 ${bracketColor} rounded-bl-md transition-colors duration-200`}
            />
            <div
              className={`absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 ${bracketColor} rounded-br-md transition-colors duration-200`}
            />
          </div>
        </div>
      )}


      {/* Close button */}
      {(state === "scanning" || state === "detected") && (
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-3 left-3 flex items-center justify-center size-8 rounded-full bg-black/40 hover:bg-black/60 transition-colors z-10"
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            className="size-4 text-white"
            strokeWidth={2}
          />
        </button>
      )}

      {/* Flash toggle */}
      {state === "scanning" && hasFlash && (
        <button
          type="button"
          onClick={toggleFlash}
          className="absolute top-3 right-3 flex items-center justify-center size-8 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
        >
          <HugeiconsIcon
            icon={FlashlightIcon}
            className="size-4 text-white"
          />
        </button>
      )}

      {/* Success — full overlay */}
      {state === "success" && (
        <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--tool-success)]/15 animate-in fade-in duration-200">
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            className="size-14 text-[color:var(--tool-success)] animate-in zoom-in duration-300"
          />
        </div>
      )}

      {/* Error — full overlay */}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[color:var(--tool-error)]/15 animate-in fade-in duration-200">
          <HugeiconsIcon
            icon={Alert02Icon}
            className="size-12 text-[color:var(--tool-error)]"
          />
          {errorMessage && (
            <p className="text-xs text-white bg-black/60 px-3 py-1.5 rounded-full">
              {errorMessage}
            </p>
          )}
        </div>
      )}

      {/* Fullscreen hint */}
      {state === "scanning" && fullscreen && (
        <p className="absolute bottom-8 inset-x-0 text-xs text-white/60 text-center">
          Align QR code within the frame
        </p>
      )}
    </div>
  )

  if (fullscreen && isActive) {
    return (
      <>
        <div className="relative w-full max-w-[320px] mx-auto">
          <div className="aspect-square rounded-xl bg-muted" />
        </div>
        <div className="fixed inset-0 z-50 bg-black">{viewfinder}</div>
      </>
    )
  }

  return (
    <div className="relative w-full max-w-[320px] mx-auto">
      {viewfinder}
      {state === "scanning" && !fullscreen && (
        <p className="text-xs text-muted-foreground text-center mt-3">
          Point at a Multica QR code
        </p>
      )}
    </div>
  )
}
