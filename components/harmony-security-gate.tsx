"use client"

import { useCallback, useEffect, useState } from "react"
import { isHarmony, harmonyCall } from "@/lib/native/harmony"
import { useAuthStore } from "@/lib/stores/auth"

/** Do not mount the SDK or login form until the encrypted native store is available. */
export function HarmonySecurityGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const initialize = useCallback(async () => {
    setStatus("loading")
    try {
      await harmonyCall("secure.get", { key: "academic-client-auth" })
      await useAuthStore.persist.rehydrate()
      if (!useAuthStore.getState().hasHydrated) throw new Error("Storage hydration failed")
      setStatus("ready")
    } catch {
      setStatus("error")
    }
  }, [])
  useEffect(() => {
    if (isHarmony()) void initialize()
  }, [initialize])
  if (!isHarmony() || status === "ready") return <>{children}</>
  return (
    <div className="native-safe-screen flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p>{status === "loading" ? "正在准备安全存储…" : "安全存储暂不可用"}</p>
      {status === "error" && (
        <>
          <p className="text-sm text-muted-foreground">
            请解锁设备后重试。恢复前不会读取或保存登录凭据。
          </p>
          <button className="rounded-md border px-4 py-2" onClick={() => void initialize()}>
            重试
          </button>
        </>
      )}
    </div>
  )
}
