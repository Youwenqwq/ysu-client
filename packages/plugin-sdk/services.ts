export interface PluginKeyValueStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface PluginStorageService {
  local: PluginKeyValueStorage
  secure: PluginKeyValueStorage
}

export interface PluginHttpService {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface PluginAssetService {
  url(path: string): string | undefined
}

export interface PluginLifecycleService {
  /** Runs after every provider initialization; late subscribers are scheduled immediately. */
  onProviderReady(listener: () => void | Promise<void>): () => void
}

export interface PluginNativeService {
  readonly isNative: boolean
  saveImage(image: Blob, fileName?: string): Promise<{ uri: string }>
  requestNotificationPermission(): Promise<boolean>
  requestExactAlarmPermission(): Promise<boolean>
  requestBatteryOptimizationExemption(): Promise<boolean>
}
