import { Capacitor } from "@capacitor/core"
import { Directory, Filesystem } from "@capacitor/filesystem"
import { createObservableSource, type ObservableSource } from "@orahako/sdk"

const DB_NAME = "orahako-profile-media"
const STORE_NAME = "files"
const AVATAR_KEY = "avatar-image.jpg"
const RENDERABLE_URL_RE = /^(https?:|blob:|data:|capacitor:|file:)/i

export function isRenderableMediaUrl(value: string): boolean {
  return RENDERABLE_URL_RE.test(value)
}

function decodeDataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",")
  if (commaIndex < 0) {
    throw new Error("Invalid data URL")
  }
  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  const mimeMatch = /^data:([^;]+)/i.exec(meta)
  const mimeType = mimeMatch?.[1] ?? "image/jpeg"

  if (meta.includes(";base64")) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mimeType })
  }
  return new Blob([decodeURIComponent(payload)], { type: mimeType })
}

async function encodeBlobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize)
    for (let i = 0; i < slice.length; i += 1) {
      binary += String.fromCharCode(slice[i]!)
    }
  }
  const mime = blob.type || "image/jpeg"
  return `data:${mime};base64,${btoa(binary)}`
}

function openMediaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export interface AvatarMediaOptions {
  readonly isNative: () => boolean
}

export class AvatarMediaController {
  readonly urlSource: ObservableSource<string | null>
  private readonly internalSource = createObservableSource<string | null>(null)
  private readonly memoryFallback = new Map<
    string,
    { readonly blob: Blob; readonly dataUrl: string }
  >()
  private activeObjectUrl: string | null = null
  private generation = 0
  private disposed = false

  constructor(private readonly options: AvatarMediaOptions) {
    this.urlSource = {
      getSnapshot: this.internalSource.getSnapshot,
      subscribe: this.internalSource.subscribe,
    }
  }

  async save(dataUrl: string): Promise<string> {
    if (this.options.isNative()) {
      const base64 = dataUrl.split(",")[1]
      if (!base64) throw new Error("Invalid avatar image data")
      await Filesystem.writeFile({
        path: AVATAR_KEY,
        data: base64,
        directory: Directory.Data,
        recursive: true,
      })
      await this.syncToken(AVATAR_KEY)
      return AVATAR_KEY
    }

    const blob = decodeDataUrlToBlob(dataUrl)
    this.revokeObjectUrl()

    if (typeof indexedDB !== "undefined") {
      const db = await openMediaDatabase()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite")
          tx.objectStore(STORE_NAME).put({ key: AVATAR_KEY, blob, ts: Date.now() })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    } else {
      this.memoryFallback.set(AVATAR_KEY, { blob, dataUrl })
    }

    await this.syncToken(AVATAR_KEY)
    return AVATAR_KEY
  }

  async remove(): Promise<void> {
    this.generation += 1
    this.revokeObjectUrl()
    this.memoryFallback.delete(AVATAR_KEY)

    if (this.options.isNative()) {
      try {
        await Filesystem.deleteFile({ path: AVATAR_KEY, directory: Directory.Data })
      } catch {
        // Ignore missing file on delete.
      }
    } else if (typeof indexedDB !== "undefined") {
      try {
        const db = await openMediaDatabase()
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite")
            tx.objectStore(STORE_NAME).delete(AVATAR_KEY)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          })
        } finally {
          db.close()
        }
      } catch {
        // Ignore unavailable IndexedDB during teardown.
      }
    }

    if (!this.disposed) {
      this.internalSource.set(null)
    }
  }

  async syncToken(token: string): Promise<void> {
    const currentGen = ++this.generation
    if (!token) {
      this.revokeObjectUrl()
      if (!this.disposed) this.internalSource.set(null)
      return
    }
    if (isRenderableMediaUrl(token)) {
      this.revokeObjectUrl()
      if (!this.disposed) this.internalSource.set(token)
      return
    }

    const loaded = await this.loadCurrentUrl()
    if (this.disposed || currentGen !== this.generation) return
    this.internalSource.set(loaded)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.revokeObjectUrl()
    this.memoryFallback.clear()
  }

  private async loadCurrentUrl(): Promise<string | null> {
    if (this.options.isNative()) {
      try {
        const { uri } = await Filesystem.getUri({
          path: AVATAR_KEY,
          directory: Directory.Data,
        })
        return `${Capacitor.convertFileSrc(uri)}?t=${Date.now()}`
      } catch {
        return null
      }
    }

    if (typeof indexedDB !== "undefined") {
      try {
        const db = await openMediaDatabase()
        let blob: Blob | null = null
        try {
          const record = await new Promise<{ readonly blob?: Blob } | undefined>(
            (resolve, reject) => {
              const tx = db.transaction(STORE_NAME, "readonly")
              const req = tx.objectStore(STORE_NAME).get(AVATAR_KEY)
              req.onsuccess = () => resolve(req.result as { readonly blob?: Blob } | undefined)
              req.onerror = () => reject(req.error)
            }
          )
          blob = record?.blob ?? null
        } finally {
          db.close()
        }
        if (!blob) return null
        return this.blobToUrl(blob)
      } catch {
        return null
      }
    }

    const mem = this.memoryFallback.get(AVATAR_KEY)
    if (!mem) return null
    return mem.dataUrl || (await this.blobToUrl(mem.blob))
  }

  private async blobToUrl(blob: Blob): Promise<string> {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      this.revokeObjectUrl()
      const objectUrl = URL.createObjectURL(blob)
      this.activeObjectUrl = objectUrl
      return objectUrl
    }
    return encodeBlobToDataUrl(blob)
  }

  private revokeObjectUrl(): void {
    if (
      this.activeObjectUrl &&
      typeof URL !== "undefined" &&
      typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(this.activeObjectUrl)
    }
    this.activeObjectUrl = null
  }
}
