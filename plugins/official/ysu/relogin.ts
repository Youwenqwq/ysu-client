import type { PluginI18nService } from "@orahako/plugin-sdk"
import { toast } from "sonner"
import type { CASProtocol } from "./protocol/cas"
import { CASCredential } from "./protocol/cas"
import { withAuthTransition } from "./auth-transition"
import type { CasAuthApi } from "./cas-auth"
import type { YSUContext } from "./context"
import type { YSUSessionLifecycle } from "./session"
import { isYSUMfaMethod } from "./types"

export interface ReloginApi {
  reloginYSU(): Promise<boolean>
}

function text(i18n: PluginI18nService, key: string): string {
  return i18n.t(key)
}

function loadRememberedCredentials(
  ctx: YSUContext
): { username: string; password: string } | null {
  const schoolId = ctx.session.getSnapshot().activeSchoolId
  if (!schoolId) return null
  const username = ctx.session.getArtifact("remembered-username", schoolId)
  const password = ctx.session.getArtifact("remembered-password", schoolId)
  return username && password ? { username, password } : null
}

export function createRelogin(
  ctx: YSUContext,
  cas: CASProtocol,
  auth: CasAuthApi,
  lifecycle: YSUSessionLifecycle
): ReloginApi {
  let inflightAutoLogin: Promise<boolean> | null = null

  function reloginYSU(): Promise<boolean> {
    if (inflightAutoLogin) return inflightAutoLogin

    const attempt = (async () => {
      const remembered = await loadRememberedCredentials(ctx)
      if (!remembered) return false

      return withAuthTransition(async () => {
        try {
          // Reset every derived session before replaying the saved credential.
          lifecycle.resetDerivedSessions()
          await auth.prepareLogin()
          if (await auth.checkCaptchaNeeded(remembered.username)) {
            toast.error(text(ctx.i18n, "autoLogin.captchaRequired"))
            return false
          }

          const step1 = await cas.loginStep1(remembered.username, remembered.password)

          if (step1.authenticated) {
            const credential = await CASCredential.fromJar(cas.getJar(), ctx.urls.casCookieDomain)
            auth.saveCredential(credential.toJSON(), remembered.username)
            await lifecycle.initializeSession()
            return true
          }

          if (step1.needsMfa) {
            try {
              const result = await ctx.mfa.show({ username: remembered.username })
              if (result.type === "wechat") {
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
              auth.saveCredential(credential.toJSON(), remembered.username)
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
