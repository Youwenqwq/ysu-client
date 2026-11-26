import { Capacitor } from "@capacitor/core"
import { Directory, Filesystem } from "@capacitor/filesystem"
import { createObservableSource, type ObservableSource } from "@orahako/sdk"

const DB_NAME = "orahako-shell-media"
const STORE_NAME = "files"
const BG_KEY = "background-image.jpg"
const RENDERABLE_URL_RE = /^(https?:|blob:|data:|capacitor:|file:)/i

export function isRenderableBackgroundUrl(value: string): boolean {
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

export interface BackgroundMediaOptions {
  readonly isNative: () => boolean
}

export class BackgroundMediaController {
  readonly urlSource: ObservableSource<string | null>
  private readonly internalSource = createObservableSource<string | null>(null)
  private readonly memoryFallback = new Map<
    string,
    { readonly blob: Blob; readonly dataUrl: string }
  >()
  private activeObjectUrl: string | null = null
  private syncedToken: string | null = null
  private generation = 0
  private disposed = false

  constructor(private readonly options: BackgroundMediaOptions) {
    this.urlSource = {
      getSnapshot: this.internalSource.getSnapshot,
      subscribe: this.internalSource.subscribe,
    }
  }

  async save(dataUrl: string): Promise<string> {
    if (this.options.isNative()) {
      const base64 = dataUrl.split(",")[1]
      if (!base64) throw new Error("Invalid background image data")
      await Filesystem.writeFile({
        path: BG_KEY,
        data: base64,
        directory: Directory.Data,
        recursive: true,
      })
      await this.syncToken(BG_KEY, { force: true })
      return BG_KEY
    }

    const blob = decodeDataUrlToBlob(dataUrl)

    if (typeof indexedDB !== "undefined") {
      const db = await openMediaDatabase()
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite")
          tx.objectStore(STORE_NAME).put({ key: BG_KEY, blob, ts: Date.now() })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    } else {
      this.memoryFallback.set(BG_KEY, { blob, dataUrl })
    }

    await this.syncToken(BG_KEY, { force: true })
    return BG_KEY
  }

  async remove(): Promise<void> {
    this.generation += 1
    this.syncedToken = ""
    this.memoryFallback.delete(BG_KEY)

    if (this.options.isNative()) {
      try {
        await Filesystem.deleteFile({ path: BG_KEY, directory: Directory.Data })
      } catch {
        // Ignore missing file on delete.
      }
    } else if (typeof indexedDB !== "undefined") {
      try {
        const db = await openMediaDatabase()
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite")
            tx.objectStore(STORE_NAME).delete(BG_KEY)
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
    this.revokeObjectUrl(this.activeObjectUrl)
    this.activeObjectUrl = null
  }

  async syncToken(token: string, options?: { readonly force?: boolean }): Promise<void> {
    if (!options?.force && this.syncedToken === token) {
      return
    }
    this.syncedToken = token
    const currentGen = ++this.generation
    if (!token) {
      if (!this.disposed) this.internalSource.set(null)
      this.revokeObjectUrl(this.activeObjectUrl)
      this.activeObjectUrl = null
      return
    }
    if (isRenderableBackgroundUrl(token)) {
      if (!this.disposed) this.internalSource.set(token)
      this.revokeObjectUrl(this.activeObjectUrl)
      this.activeObjectUrl = null
      return
    }

    const loaded = await this.loadCurrentUrl()
    if (this.disposed || currentGen !== this.generation) {
      if (loaded?.objectUrl) {
        this.revokeObjectUrl(loaded.objectUrl)
      }
      return
    }
    const previousObjectUrl = this.activeObjectUrl
    this.activeObjectUrl = loaded?.objectUrl ?? null
    this.internalSource.set(loaded?.url ?? null)
    if (previousObjectUrl && previousObjectUrl !== this.activeObjectUrl) {
      this.revokeObjectUrl(previousObjectUrl)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.syncedToken = null
    this.revokeObjectUrl(this.activeObjectUrl)
    this.activeObjectUrl = null
    this.memoryFallback.clear()
  }

  private async loadCurrentUrl(): Promise<{
    readonly url: string
    readonly objectUrl: string | null
  } | null> {
    if (this.options.isNative()) {
      try {
        const { uri } = await Filesystem.getUri({
          path: BG_KEY,
          directory: Directory.Data,
        })
        return { url: `${Capacitor.convertFileSrc(uri)}?t=${Date.now()}`, objectUrl: null }
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
              const req = tx.objectStore(STORE_NAME).get(BG_KEY)
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

    const mem = this.memoryFallback.get(BG_KEY)
    if (!mem) return null
    if (mem.dataUrl) {
      return { url: mem.dataUrl, objectUrl: null }
    }
    return this.blobToUrl(mem.blob)
  }

  private async blobToUrl(
    blob: Blob
  ): Promise<{ readonly url: string; readonly objectUrl: string | null }> {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const objectUrl = URL.createObjectURL(blob)
      return { url: objectUrl, objectUrl }
    }
    return { url: await encodeBlobToDataUrl(blob), objectUrl: null }
  }

  private revokeObjectUrl(objectUrl: string | null): void {
    if (objectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(objectUrl)
    }
  }
}
