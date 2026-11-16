import type { CookieEntry, HttpRequest, HttpResponse } from "./http"

export interface CookieJar {
  setCookie(cookie: string, url: string, options?: { ignoreError?: boolean }): Promise<void>
  getCookieString(url: string): Promise<string>
  getAllCookies(): Promise<readonly CookieEntry[]>
  removeCookie(domain: string, path: string, key: string): Promise<void>
  toJSON(): string
}

export interface SessionSnapshot {
  readonly activeSchoolId: string | null
  readonly credential: string | null
  readonly username: string | null
  readonly isAuthenticated: boolean
  readonly sessionExpired: boolean
  readonly hasHydrated: boolean
  readonly artifacts: Readonly<Record<string, string>>
}

export interface CredentialInput {
  schoolId: string
  credential: string
  username?: string | null
}

/** Authentication state and session transport; no school-specific field names. */
export interface PluginSessionService {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  setCredential(input: CredentialInput): void
  activateSchool(schoolId: string): void
  clearCredential(schoolId?: string): void
  setSessionExpired(expired: boolean): void
  setArtifact(key: string, value: string | null, schoolId?: string): void
  getArtifact(key: string, schoolId?: string): string | null
  createCookieJar(serialized?: string): CookieJar
  fetchWithJar(jar: CookieJar, request: HttpRequest): Promise<HttpResponse>
}
