import { validatePluginManifest, type PluginManifest } from "@orahako/plugin-sdk"
import {
  parsePluginPackage,
  type PluginPackageFile,
  type PluginPackageLimits,
} from "./plugin-package"

const DEFAULT_DATABASE_NAME = "orahako-plugins"
const DATABASE_VERSION = 1
const PACKAGE_STORE_NAME = "packages"
const STORED_RECORD_VERSION = 1

/** A fully validated plugin package persisted in the store. */
export interface PluginPackageSnapshot {
  manifest: PluginManifest
  files: readonly PluginPackageFile[]
  installedAt: number
}

/** Storage-level summary returned by list(); file contents are loaded via read(). */
export interface InstalledPluginSummary {
  manifest: PluginManifest
  installedAt: number
  fileCount: number
  byteSize: number
}

export type PluginPackageInput = Uint8Array | ArrayBuffer | Blob

export type PluginPackageStoreErrorCode = "unavailable" | "storage" | "format"

export class PluginPackageStoreError extends Error {
  constructor(
    readonly code: PluginPackageStoreErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "PluginPackageStoreError"
  }
}

/**
 * Persistence boundary for validated packages. The bundled implementation
 * uses IndexedDB; tests inject an in-memory backend.
 */
export interface PluginPackageBackend {
  get(id: string): Promise<PluginPackageSnapshot | undefined>
  getAll(): Promise<readonly PluginPackageSnapshot[]>
  put(snapshot: PluginPackageSnapshot): Promise<void>
  delete(id: string): Promise<void>
  close(): void
}

export interface IndexedDbPackageBackendOptions {
  databaseName?: string
  factory?: IDBFactory
}

export interface PluginPackageStoreOptions {
  backend?: PluginPackageBackend
  databaseName?: string
  indexedDB?: IDBFactory
  now?: () => number
  limits?: Partial<PluginPackageLimits>
}

interface StoredPackageRecord {
  id: string
  recordVersion: number
  manifest: PluginManifest
  files: PluginPackageFile[]
  installedAt: number
}

/**
 * Versioned external plugin installer.
 *
 * Packages are parsed and validated completely before the backend is touched,
 * so a broken ZIP, unsafe path, missing entry, or incompatible apiVersion can
 * never replace a previously-installed package.
 */
export class PluginPackageStore {
  private backend: PluginPackageBackend | undefined

  constructor(private readonly options: PluginPackageStoreOptions = {}) {}

  async install(input: PluginPackageInput): Promise<PluginPackageSnapshot> {
    const bytes = await readPackageBytes(input)
    const pkg = parsePluginPackage(bytes, this.options.limits)
    const snapshot: PluginPackageSnapshot = {
      manifest: pkg.manifest,
      files: pkg.files,
      installedAt: this.options.now?.() ?? Date.now(),
    }

    await this.storageAction("install", () => this.resolveBackend().put(snapshot))
    return snapshot
  }

  async restore(snapshot: PluginPackageSnapshot): Promise<void> {
    validatePluginManifest(snapshot.manifest)
    await this.storageAction("install", () => this.resolveBackend().put(snapshot))
  }

  async list(): Promise<readonly InstalledPluginSummary[]> {
    const snapshots = await this.storageAction("list", () => this.resolveBackend().getAll())
    return snapshots
      .map((snapshot): InstalledPluginSummary => {
        const byteSize = snapshot.files.reduce((total, file) => total + file.data.byteLength, 0)
        return {
          manifest: snapshot.manifest,
          installedAt: snapshot.installedAt,
          fileCount: snapshot.files.length,
          byteSize,
        }
      })
      .sort(
        (a, b) =>
          a.manifest.name.localeCompare(b.manifest.name) ||
          a.manifest.id.localeCompare(b.manifest.id)
      )
  }

  async read(id: string): Promise<PluginPackageSnapshot | undefined> {
    return this.storageAction("read", () => this.resolveBackend().get(id))
  }

  async remove(id: string): Promise<void> {
    await this.storageAction("remove", () => this.resolveBackend().delete(id))
  }

  close(): void {
    this.backend?.close()
    this.backend = undefined
  }

  private resolveBackend(): PluginPackageBackend {
    if (!this.backend) {
      this.backend =
        this.options.backend ??
        createIndexedDbPackageBackend({
          databaseName: this.options.databaseName,
          factory: this.options.indexedDB,
        })
    }
    return this.backend
  }

  private async storageAction<T>(action: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof PluginPackageStoreError) throw error
      throw new PluginPackageStoreError("storage", `Failed to ${action} plugin package storage`, {
        cause: error,
      })
    }
  }
}

/** IndexedDB-backed package backend with a lazily opened, versioned database. */
export function createIndexedDbPackageBackend(
  options: IndexedDbPackageBackendOptions = {}
): PluginPackageBackend {
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME
  let databasePromise: Promise<IDBDatabase> | undefined

  const openDatabase = (): Promise<IDBDatabase> => {
    if (databasePromise) return databasePromise

    const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>()
    databasePromise = promise

    const factory = options.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB)
    if (!factory) {
      databasePromise = undefined
      reject(new PluginPackageStoreError("unavailable", "IndexedDB is not available"))
      return promise
    }

    let settled = false
    const fail = (error: PluginPackageStoreError) => {
      if (settled) return
      settled = true
      databasePromise = undefined
      reject(error)
    }

    let request: IDBOpenDBRequest
    try {
      request = factory.open(databaseName, DATABASE_VERSION)
    } catch (error) {
      fail(
        new PluginPackageStoreError("storage", `Failed to open plugin database ${databaseName}`, {
          cause: error,
        })
      )
      return promise
    }

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
        database.createObjectStore(PACKAGE_STORE_NAME, { keyPath: "id" })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      if (settled) {
        // A blocked open can still succeed after the caller already saw an error.
        database.close()
        return
      }
      settled = true
      database.onversionchange = () => {
        database.close()
        databasePromise = undefined
      }
      resolve(database)
    }
    request.onerror = () =>
      fail(
        new PluginPackageStoreError("storage", `Failed to open plugin database ${databaseName}`, {
          cause: request.error,
        })
      )
    request.onblocked = () =>
      fail(
        new PluginPackageStoreError(
          "unavailable",
          `Plugin database ${databaseName} is blocked by another connection`
        )
      )
    return promise
  }

  const openTransaction = async (
    mode: IDBTransactionMode
  ): Promise<{ store: IDBObjectStore; done: Promise<void> }> => {
    const database = await openDatabase()
    const transaction = database.transaction(PACKAGE_STORE_NAME, mode)
    const completed = Promise.withResolvers<void>()
    transaction.oncomplete = () => completed.resolve()
    transaction.onerror = () =>
      completed.reject(transaction.error ?? new Error("Plugin database transaction failed"))
    transaction.onabort = () =>
      completed.reject(transaction.error ?? new Error("Plugin database transaction aborted"))
    return { store: transaction.objectStore(PACKAGE_STORE_NAME), done: completed.promise }
  }

  return {
    async get(id) {
      const { store, done } = await openTransaction("readonly")
      try {
        const record = await requestResult<StoredPackageRecord | undefined>(store.get(id))
        return record ? fromStoredRecord(record) : undefined
      } finally {
        await done
      }
    },

    async getAll() {
      const { store, done } = await openTransaction("readonly")
      try {
        const records = await requestResult<StoredPackageRecord[]>(store.getAll())
        return records.map(fromStoredRecord)
      } finally {
        await done
      }
    },

    async put(snapshot) {
      const { store, done } = await openTransaction("readwrite")
      store.put(toStoredRecord(snapshot))
      await done
    },

    async delete(id) {
      const { store, done } = await openTransaction("readwrite")
      store.delete(id)
      await done
    },

    close() {
      if (!databasePromise) return
      const pending = databasePromise
      databasePromise = undefined
      void pending.then((database) => database.close()).catch(() => undefined)
    },
  }
}

function toStoredRecord(snapshot: PluginPackageSnapshot): StoredPackageRecord {
  return {
    id: snapshot.manifest.id,
    recordVersion: STORED_RECORD_VERSION,
    manifest: snapshot.manifest,
    files: [...snapshot.files],
    installedAt: snapshot.installedAt,
  }
}

function fromStoredRecord(record: StoredPackageRecord): PluginPackageSnapshot {
  if (record.recordVersion !== STORED_RECORD_VERSION) {
    throw new PluginPackageStoreError(
      "format",
      `Unsupported plugin package record version: ${record.recordVersion}`
    )
  }
  return {
    manifest: record.manifest,
    files: record.files,
    installedAt: record.installedAt,
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error("Plugin database request failed"))
  return promise
}

async function readPackageBytes(input: PluginPackageInput): Promise<Uint8Array> {
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (isBlobInput(input)) return new Uint8Array(await input.arrayBuffer())
  throw new TypeError("Plugin package input must be a Uint8Array, ArrayBuffer, or Blob")
}

function isBlobInput(input: PluginPackageInput): input is Blob {
  return (
    typeof input === "object" &&
    input !== null &&
    "arrayBuffer" in input &&
    typeof input.arrayBuffer === "function"
  )
}
