import { toast } from "sonner"
import type { PluginI18nService } from "@orahako/sdk"
import type { CasAuthApi } from "./cas-auth"
import type { YSUContext } from "./context"
import { CASCredential, type CASProtocol } from "./protocol/cas"
import type { YSUSessionLifecycle } from "./session"
import { getYSUMfaMethods, isYSUMfaMethod } from "./types"

export interface ReloginApi {
  reloginYSU(): Promise<boolean>
}

const REMEMBERED_USERNAME_ARTIFACT = "remembered-username"
const REMEMBERED_PASSWORD_ARTIFACT = "remembered-password"

interface RememberedCredentials {
  readonly schoolId: string
  readonly username: string
  readonly password: string
}

function text(i18n: PluginI18nService, key: string): string {
  return i18n.t(key)
}

function loadRememberedCredentials(ctx: YSUContext): RememberedCredentials | null {
  const schoolId = ctx.session.getSnapshot().activeSchoolId ?? ctx.config.id
  if (!schoolId) return null
  const username = ctx.session.getArtifact(REMEMBERED_USERNAME_ARTIFACT, schoolId)
  const password = ctx.session.getArtifact(REMEMBERED_PASSWORD_ARTIFACT, schoolId)
  return username && password ? { schoolId, username, password } : null
}

function keepRememberedCredentials(ctx: YSUContext, remembered: RememberedCredentials): void {
  // saveCredential resets artifacts for the school, so re-write the keys read by relogin.
  ctx.session.setArtifact(REMEMBERED_USERNAME_ARTIFACT, remembered.username, remembered.schoolId)
  ctx.session.setArtifact(
    REMEMBERED_PASSWORD_ARTIFACT,
    remembered.password,
    remembered.schoolId
  )
}

function saveReloginCredential(
  ctx: YSUContext,
  auth: CasAuthApi,
  remembered: RememberedCredentials,
  credential: string
): void {
  auth.saveCredential(credential, remembered.username)
  keepRememberedCredentials(ctx, remembered)
}

export function createRelogin(
  ctx: YSUContext,
  cas: CASProtocol,
  auth: CasAuthApi,
  lifecycle: YSUSessionLifecycle
): ReloginApi {
  const { withAuthTransition } = ctx.transition
  let inflightAutoLogin: Promise<boolean> | null = null

  function reloginYSU(): Promise<boolean> {
    if (inflightAutoLogin) return inflightAutoLogin

    const attempt = (async () => {
      const remembered = loadRememberedCredentials(ctx)
      if (!remembered) return false

      return withAuthTransition(async () => {
        try {
          lifecycle.resetDerivedSessions()
          await auth.prepareLogin()
          if (await auth.checkCaptchaNeeded(remembered.username)) {
            toast.error(text(ctx.i18n, "autoLogin.captchaRequired"))
            return false
          }

          const step1 = await cas.loginStep1(remembered.username, remembered.password)

          if (step1.authenticated) {
            const credential = await CASCredential.fromJar(cas.getJar(), ctx.urls.casCookieDomain)
            saveReloginCredential(ctx, auth, remembered, credential.toJSON())
            await lifecycle.initializeSession()
            return true
          }

          if (step1.needsMfa) {
            try {
              const result = await ctx.mfa.show({
                username: remembered.username,
                methods: getYSUMfaMethods(),
              })
              if (result.type === "wechat") {
                if (!(await auth.isAuthenticated())) return false
                const credential = await CASCredential.fromJar(
                  cas.getJar(),
                  ctx.urls.casCookieDomain
                )
                if (credential.cookies.length > 0) {
                  saveReloginCredential(ctx, auth, remembered, credential.toJSON())
                }
                await lifecycle.initializeSession()
                return true
              }
              if (!isYSUMfaMethod(result.method)) return false
              const credential = await cas.submitMFACode(
                {
                  method: result.method,
                  methodCode: result.methodCode,
                  mobileHint: "",
                  username: remembered.username,
                  raw: {},
                },
                result.code
              )
              saveReloginCredential(ctx, auth, remembered, credential.toJSON())
              await lifecycle.initializeSession()
              return true
            } catch {
              return false
            }
          }
          return false
        } catch {
          return false
        }
      })
    })()

    inflightAutoLogin = attempt
    void attempt.finally(() => {
      if (inflightAutoLogin === attempt) inflightAutoLogin = null
    })
    return attempt
  }

  return { reloginYSU }
}
