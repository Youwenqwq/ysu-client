/** Build identity is shared with the native bundle; it is safe during SSG. */
export const isMacOSApp = process.env.NEXT_PUBLIC_MACOS_APP === "1"

interface MacHttpRequest {
  url: string
  method: "GET" | "POST"
  headers: Record<string, string>
  bodyBase64?: string
  timeoutMs?: number
}

interface MacHttpResponse {
  status: number
  headers: Record<string, string | string[]>
  url: string
  bodyBase64: string
}

interface MacBridge {
  postMessage(message: { operation: string; payload: unknown }): Promise<unknown>
}

function bridge(): MacBridge | undefined {
  if (
    !isMacOSApp ||
    typeof window === "undefined" ||
    window.location.origin !== "http://127.0.0.1:17346" ||
    window.top !== window
  ) return undefined
  return (window as Window & {
    webkit?: { messageHandlers?: { ysuNative?: MacBridge } }
  }).webkit?.messageHandlers?.ysuNative
}

/** A Web build, an external page and a subframe cannot opt into this bridge. */
export function isMacOSNative(): boolean {
  return typeof bridge()?.postMessage === "function"
}

/** Invoke an allowlisted native operation from the bundled macOS shell only. */
export async function macInvoke<T>(operation: string, payload: unknown): Promise<T> {
  const handler = bridge()
  if (!handler) throw new Error("macOS native bridge is unavailable")
  return await handler.postMessage({ operation, payload }) as T
}

export function macHttpRequest(payload: MacHttpRequest): Promise<MacHttpResponse> {
  return macInvoke("http", payload)
}

export const macSecureStorage = {
  async getItem(name: string): Promise<string | null> {
    return (await macInvoke<{ value: string | null }>("storage.get", { name })).value
  },
  async setItem(name: string, value: string): Promise<void> {
    await macInvoke("storage.set", { name, value })
  },
  async removeItem(name: string): Promise<void> {
    await macInvoke("storage.remove", { name })
  },
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Chunking avoids argument/stack limits for binary images and documents.
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
