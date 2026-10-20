import { harmonyCall } from "@/lib/native/harmony"
import type { DataType } from "@aparajita/capacitor-secure-storage"

/** Asset Store Kit only. Errors propagate; there is deliberately no web fallback. */
export const HarmonySecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const result = await harmonyCall<{ value: string | null }>("secure.get", { key })
    return result.value
  },
  async setItem(key: string, value: string): Promise<void> {
    await harmonyCall("secure.set", { key, value })
  },
  async removeItem(key: string): Promise<void> {
    await harmonyCall("secure.remove", { key })
  },
  async get(key: string): Promise<DataType | null> {
    const value = await this.getItem(key)
    return value === null ? null : JSON.parse(value)
  },
  async set(key: string, value: DataType): Promise<void> {
    await this.setItem(key, JSON.stringify(value))
  },
  async remove(key: string): Promise<void> {
    await this.removeItem(key)
  },
}
