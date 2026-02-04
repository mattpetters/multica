"use client"

import { useState, useEffect } from "react"
import { useConnectionStore } from "./connection-store"
import { loadConnection } from "./connection"

/** Auto-connect from saved connection code on mount, skip if already connected */
export function useAutoConnect(): { loading: boolean } {
  const connectionState = useConnectionStore((s) => s.connectionState)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const state = useConnectionStore.getState()
    if (state.connectionState !== "disconnected") {
      setLoading(false)
      return
    }
    const saved = loadConnection()
    if (saved) {
      state.connect(saved)
    } else {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connectionState !== "disconnected") {
      setLoading(false)
    }
  }, [connectionState])

  return { loading }
}
