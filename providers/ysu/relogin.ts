import { toast } from "sonner"
import {
  loginStep1,
  submitMFACode,
  CASCredential,
  resetCAS,
  checkCaptchaNeeded,
  prepareLogin,
  getJar,
  NeedCaptchaError,
} from "./protocol/cas"
import { resetJWXT } from "./protocol/jwxt"
import { resetLdxt } from "./protocol/ldxt"
import { resetScxt } from "./protocol/scxt"
import { resetXgxt } from "./protocol/xgxt"
import { resetEpay } from "./protocol/epay"
import { resetMobileAuth } from "./protocol/jwmobile"
import { initializeSession } from "./session"
import { withAuthTransition } from "./auth-transition"
import { useAuthStore } from "@/lib/stores/auth"
import { useMFAModalStore } from "@/lib/stores/mfa-modal"
import { getText } from "@/lib/i18n/get-text"
import { loadRememberedCredentials } from "@/lib/storage/secure"
import { isYSUMfaMethod } from "./types"

let inflightAutoLogin: Promise<boolean> | null = null

export function reloginYSU(): Promise<boolean> {
  if (inflightAutoLogin) return inflightAutoLogin

  const attempt = (async () => {
    const remembered = await loadRememberedCredentials()
    if (!remembered) return false

    return withAuthTransition(async () => {
      try {
        resetCAS()
        resetJWXT()
        resetLdxt()
        resetScxt()
        resetXgxt()
        resetEpay()
        resetMobileAuth()
        await prepareLogin()
        if (await checkCaptchaNeeded(remembered.username)) {
          toast.error(getText("autoLogin.captchaRequired"))
          return false
        }

        const step1 = await loginStep1(remembered.username, remembered.password)

        if (step1.authenticated) {
          const credential = await CASCredential.fromJar(getJar())
          const json = credential.toJSON()
          useAuthStore.getState().setCredential(json, remembered.username)
          await initializeSession()
          return true
        }

        if (step1.needsMfa) {
          const store = useMFAModalStore.getState()

          try {
            const result = await store.showMFA({ username: remembered.username })
            if (result.type === "wechat") {
              await initializeSession()
              return true
            }
            if (!isYSUMfaMethod(result.method)) {
              return false
            }
            const credential = await submitMFACode(
              {
                method: result.method,
                methodCode: result.methodCode,
                mobileHint: "",
                username: remembered.username,
                raw: {},
              },
              result.code
            )
            const json = credential.toJSON()
            useAuthStore.getState().setCredential(json, remembered.username)
            await initializeSession()
            return true
          } catch {
            return false
          }
        }

        return false
      } catch (err) {
        if (err instanceof NeedCaptchaError) {
          toast.error(getText("autoLogin.captchaRequired"))
        }
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
