import {
  definePlugin,
  isTablet,
  PLUGIN_API_VERSION,
  type Context,
  type ObservableSource,
} from "@orahako/sdk"
import type {
  AuthSlice,
  MfaChallenge,
  MfaRequestInput,
  ProviderRuntimeService,
  ProviderRuntimeSnapshot,
  SessionService,
} from "@orahako/academic-sdk"
import { mfaDictionary } from "./dictionary"
import { MFAModal, type MfaModalInject } from "./modal"
import { createMfaService } from "./store"

export const MFA_PLUGIN_ID = "orahako.mfa"

export const UNAVAILABLE_PROVIDER_SNAPSHOT: ProviderRuntimeSnapshot = {
  status: "unavailable",
  schoolId: null,
  provider: null,
  error: null,
  generation: 0,
}

const NOOP_UNSUBSCRIBE = () => {}

export const STATIC_UNAVAILABLE_PROVIDER_SOURCE: ObservableSource<ProviderRuntimeSnapshot> = {
  getSnapshot: () => UNAVAILABLE_PROVIDER_SNAPSHOT,
  subscribe: () => NOOP_UNSUBSCRIBE,
}

export function buildMfaModalInject(registrantCtx: Context): MfaModalInject {
  const initialProvider = registrantCtx.get("provider")
  const initialSession = registrantCtx.get("session")

  const resolveProviderService = (): ProviderRuntimeService | undefined =>
    registrantCtx.get("provider") ?? initialProvider

  const resolveSessionService = (): SessionService | undefined =>
    registrantCtx.get("session") ?? initialSession

  const resolveAuthSlice = (): AuthSlice | undefined =>
    resolveProviderService()?.getSnapshot().provider?.slices.auth

  return {
    isTablet: () => isTablet(),
    canRequestMfaCode: () => typeof resolveAuthSlice()?.requestMfaCode === "function",
    requestMfaCode: async (input: MfaRequestInput): Promise<MfaChallenge> => {
      const auth = resolveAuthSlice()
      if (!auth?.requestMfaCode) {
        throw new Error("Active provider does not support MFA code requests")
      }
      return auth.requestMfaCode(input)
    },
    wechatMfa: {
      isAvailable: () => resolveAuthSlice()?.wechatMfa !== undefined,
      initiateWechatMfa: async () => {
        const wechat = resolveAuthSlice()?.wechatMfa
        if (!wechat) {
          throw new Error("WeChat MFA is unavailable on the active provider")
        }
        return wechat.initiateWechatMfa()
      },
      pollWechatMfaQr: async (uuid, lastErrcode, signal) => {
        const wechat = resolveAuthSlice()?.wechatMfa
        if (!wechat) {
          throw new Error("WeChat MFA is unavailable on the active provider")
        }
        return wechat.pollWechatMfaQr(uuid, lastErrcode, signal)
      },
      completeWechatMfa: async (code, state, username) => {
        const wechat = resolveAuthSlice()?.wechatMfa
        if (!wechat) {
          throw new Error("WeChat MFA is unavailable on the active provider")
        }
        const credential = await wechat.completeWechatMfa(code, state)
        const session = resolveSessionService()
        if (session) {
          const schoolId =
            session.getSnapshot().activeSchoolId ??
            resolveProviderService()?.getSnapshot().schoolId ??
            null
          if (!schoolId) {
            throw new Error("No active school for MFA credential")
          }
          session.setCredential({ schoolId, credential, username })
        }
        return credential
      },
    },
    hooks: {
      providerState: initialProvider ? initialProvider.state : STATIC_UNAVAILABLE_PROVIDER_SOURCE,
    },
  }
}

export const mfaPlugin = definePlugin({
  manifest: {
    id: MFA_PLUGIN_ID,
    name: "多因素验证",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    provides: ["mfa"],
    providerIndependent: true,
    entry: "index.js",
    inject: ["slots", "i18n"],
  },
  inject: ["slots", "i18n"] as const,
  apply(ctx) {
    const mfaService = createMfaService()

    ctx.effect(() => () => {
      mfaService.dispose()
    })

    ctx.i18n.register(mfaDictionary)
    ctx.set("mfa", mfaService)

    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          id: "mfa-modal",
          slot: "shell.overlay",
          dictionary: mfaDictionary,
          store: mfaService.store,
          inject: buildMfaModalInject,
        },
        MFAModal
      )
    )
  },
})
