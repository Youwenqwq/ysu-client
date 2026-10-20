/** A Harmony build must never fall back to a browser proxy or plaintext storage. */
export function isHarmony(): boolean {
  return process.env.NEXT_PUBLIC_APP_PLATFORM === "harmony"
}

interface HarmonyBridge {
  postMessage(message: string): void
}

declare global {
  interface Window {
    YSUHarmony?: HarmonyBridge
    __ysuHarmonyReply?: (reply: { id: string; ok: boolean; data?: unknown; error?: string }) => void
  }
}

const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()
let sequence = 0

export function harmonyCall<T>(method: string, params: object = {}): Promise<T> {
  if (!isHarmony() || typeof window === "undefined" || !window.YSUHarmony) {
    return Promise.reject(new Error("鸿蒙安全服务尚未就绪，请重新打开应用"))
  }
  window.__ysuHarmonyReply = (reply) => {
    const call = pending.get(reply.id)
    if (!call) return
    pending.delete(reply.id)
    clearTimeout(call.timer)
    if (reply.ok) call.resolve(reply.data)
    else call.reject(new Error(reply.error || "鸿蒙安全服务调用失败"))
  }
  const id = `h${++sequence}`
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error("鸿蒙安全服务响应超时"))
    }, 65_000)
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
    try {
      window.YSUHarmony!.postMessage(JSON.stringify({ id, method, params }))
    } catch {
      clearTimeout(timer)
      pending.delete(id)
      reject(new Error("鸿蒙安全服务不可用"))
    }
  })
}
