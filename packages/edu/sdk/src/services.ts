import type { Context } from "@cordisjs/core"
import type {
  ChildrenSpec,
  CookieEntry,
  DerivedComponentProps,
  HttpRequest,
  HttpResponse,
  ObservableSource,
  PluginIcon,
  SlotComponent,
  ValidInject,
} from "@orahako/sdk"
import type { MfaChallenge, MfaMethod } from "./entities"
import type { ProviderError } from "./errors"
import type { AcademicSliceKey, SchoolProvider } from "./slices"

export type ProviderFactory = (ctx: Context) => SchoolProvider

export interface ProviderRegistryService {
  registerProvider(schoolId: string, factory: ProviderFactory): () => void
  hasProvider(schoolId: string): boolean
  listProviders(): readonly string[]
  createProvider(schoolId: string): SchoolProvider
  subscribe(listener: (schoolId: string) => void): () => void
}

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
  readonly schoolId: string
  readonly credential: string
  readonly username?: string | null
}

export interface SessionService {
  readonly state: ObservableSource<SessionSnapshot>
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

export type ProviderRuntimeStatus = "unavailable" | "initializing" | "ready" | "error"

export interface ProviderRuntimeSnapshot {
  readonly status: ProviderRuntimeStatus
  readonly schoolId: string | null
  readonly provider: SchoolProvider | null
  readonly error: Error | null
  readonly generation: number
}

export interface ProviderRuntimeService {
  readonly state: ObservableSource<ProviderRuntimeSnapshot>
  getSnapshot(): ProviderRuntimeSnapshot
  subscribe(listener: () => void): () => void
  getActive(): SchoolProvider
  selectSchool(schoolId: string): SchoolProvider
  initialize(): Promise<SchoolProvider>
  reset(): Promise<void>
  logout(): Promise<void>
  relogin(): Promise<boolean>
}

export interface ProviderQueryPolicy {
  readonly ttl: number
  readonly persist: boolean
}

export interface ProviderQueryIdentity {
  readonly providerId: string
  /** School id plus provider generation; never school protocol fields. */
  readonly providerScope: string
  readonly username: string | null
  readonly feature: string
  readonly params?: unknown
}

export interface PersistentQueryValue<T = unknown> {
  readonly data: T
  readonly updatedAt: number
}

export type QueryStatus = "idle" | "loading" | "success" | "error"

export interface QuerySnapshot<T> {
  readonly status: QueryStatus
  readonly data: T | undefined
  readonly error: ProviderError | Error | null
  readonly isLoading: boolean
  readonly isRefreshing: boolean
  readonly isStale: boolean
  readonly updatedAt: number | null
  refresh(): Promise<T | undefined>
}

export interface QueryDescriptor<T, K extends AcademicSliceKey = AcademicSliceKey> {
  readonly feature: string
  readonly slice?: K
  readonly params?: unknown
  readonly enabled?: boolean | (() => boolean)
  /** Release this source's in-memory handle and record after its last subscriber detaches. */
  readonly releaseOnInactive?: boolean
  fetcher(provider: SchoolProvider): Promise<T>
}

export interface QueryActivitySnapshot {
  readonly refreshingCount: number
  readonly staleCount: number
}

export interface QueryService {
  source<T, K extends AcademicSliceKey = AcademicSliceKey>(
    descriptor: QueryDescriptor<T, K>
  ): ObservableSource<QuerySnapshot<T>>
  readonly activity: ObservableSource<QueryActivitySnapshot>
  policy(feature: string): ProviderQueryPolicy
  registerPolicy(feature: string, policy: ProviderQueryPolicy): () => void
  invalidate(identity?: Partial<ProviderQueryIdentity>): void
  key(identity: ProviderQueryIdentity): readonly unknown[]
  cacheKey(identity: ProviderQueryIdentity & { username: string }): string
  readPersistent<T>(key: string): PersistentQueryValue<T> | null
  writePersistent<T>(key: string, value: PersistentQueryValue<T>): void
  clearPersistent(): void
}

export type PollingFlagMapping =
  | string
  | ((enabled: boolean) => boolean | Readonly<Record<string, boolean>>)

export interface AcademicNotificationChannelSpec {
  readonly id: string
  readonly slice?: AcademicSliceKey
  readonly toPollingFlag?: PollingFlagMapping
  onDisable?(): void | Promise<void>
}

export interface AcademicNotificationChannel extends AcademicNotificationChannelSpec {
  readonly pluginId: string
}

export interface AcademicNotificationService {
  readonly state: ObservableSource<readonly AcademicNotificationChannel[]>
  registerChannel(channel: AcademicNotificationChannelSpec): () => void
  getSnapshot(): readonly AcademicNotificationChannel[]
  subscribe(listener: () => void): () => void
}

export interface MfaRequest {
  readonly username: string
  readonly method?: MfaMethod
  readonly methods?: readonly MfaMethod[]
  readonly challenge?: Partial<MfaChallenge>
}

export type MfaResult =
  | {
      readonly type: "code"
      readonly method: string
      readonly methodCode: string
      readonly code: string
    }
  | { readonly type: "wechat" }

export interface MfaService {
  show(request: MfaRequest): Promise<MfaResult>
}

export type OverviewWidgetRegion = "summary" | "content"

export interface OverviewWidgetSpec<
  Dict = undefined,
  Children extends ChildrenSpec | undefined = undefined,
  Store = undefined,
  I = undefined,
> {
  readonly id: string
  readonly title?: string
  readonly titleKey?: string
  readonly description?: string
  readonly descriptionKey?: string
  readonly icon: PluginIcon
  readonly region: OverviewWidgetRegion
  readonly defaultVisible: boolean
  readonly order?: number
  readonly slice?: AcademicSliceKey
  readonly capability?: string
  readonly dictionary?: Dict
  readonly children?: Children
  readonly store?: Store
  readonly inject?: (ctx: Context) => ValidInject<I>
}

export interface OverviewWidgetContribution {
  readonly id: string
  readonly pluginId: string
  readonly title?: string
  readonly titleKey?: string
  readonly description?: string
  readonly descriptionKey?: string
  readonly icon: PluginIcon
  readonly region: OverviewWidgetRegion
  readonly defaultVisible: boolean
  readonly order?: number
  readonly slice?: AcademicSliceKey
  readonly capability?: string
  readonly dictionary?: unknown
  readonly children?: ChildrenSpec
  readonly store?: unknown
  readonly inject?: (ctx: Context) => unknown
  readonly component: SlotComponent<never>
}

export interface OverviewService {
  readonly state: ObservableSource<readonly OverviewWidgetContribution[]>
  getSnapshot(): readonly OverviewWidgetContribution[]
  subscribe(listener: () => void): () => void
  registerWidget<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: OverviewWidgetSpec<Dict, Children, Store, I>,
    Component: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    >
  ): () => void
  registerWidget<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: OverviewWidgetSpec<Dict, Children, Store, I> & {
      readonly component: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    }
  ): () => void
}

export interface AcademicServiceMap {
  providers: ProviderRegistryService
  session: SessionService
  provider: ProviderRuntimeService
  query: QueryService
  notifications: AcademicNotificationService
  mfa: MfaService
  overview: OverviewService
}

declare module "@orahako/sdk" {
  interface OrahakoServiceMap extends AcademicServiceMap {}
}

declare module "@cordisjs/core" {
  interface Context extends AcademicServiceMap {}

  interface Events {
    "session/changed"(snapshot: SessionSnapshot): void
    "session/expired"(snapshot: SessionSnapshot): void
    "provider/changed"(snapshot: ProviderRuntimeSnapshot): void
    "provider/ready"(snapshot: ProviderRuntimeSnapshot): void
    "query/invalidate"(identity: Partial<ProviderQueryIdentity> | undefined): void
  }
}
