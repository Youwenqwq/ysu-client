import rawConfig from "./ysu.json"

/**
 * YSU-owned protocol configuration.
 *
 * The host provider runtime knows nothing about these fields; they are defined
 * and consumed entirely inside the YSU provider plugin.
 */
export interface YSUConfig {
  readonly id: string
  readonly name: string
  readonly nameEn: string
  readonly cas: {
    readonly cerBaseUrl: string
    readonly aesChars: string
    readonly mfaMethodToCode: Readonly<Record<string, string>>
    readonly mfaMethodToAuthCodeType: Readonly<Record<string, string>>
  }
  readonly jwxt: {
    readonly jwxtBaseUrl: string
    readonly portalPath: string
    readonly appShowPath: string
    readonly appIds: Readonly<Record<string, string>>
    readonly apiPaths: Readonly<Record<string, string>>
    /** Workaround: some backends return 404 for pjapp; retry with this route. */
    readonly pjappGoodRoute?: string
  }
  readonly ldxt?: {
    readonly baseUrl: string
  }
  readonly scxt?: {
    readonly baseUrl: string
    readonly ptBaseUrl: string
  }
  readonly xgxt?: {
    readonly baseUrl: string
  }
  readonly features: {
    readonly hasMobile: boolean
    readonly hasLabSchedule: boolean
    readonly hasMfa: boolean
  }
  readonly visible: boolean
}

/** YSU-owned school configuration contributed by this provider plugin. */
export const YSU_CONFIG: YSUConfig = rawConfig
export const YSU_SESSION_ARTIFACT_JWXT = "jwxtSession"
export const YSU_SESSION_ARTIFACT_MOBILE = "mobileSession"
export const YSU_SECURE_KEY_CAS_TGC = "casTgc"
