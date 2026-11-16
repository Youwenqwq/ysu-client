import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionPlugin,
  type MfaRequest,
} from "@orahako/plugin-sdk"
import { useMFAModalStore } from "@/plugins/official/shell/stores/mfa-modal"

export const mfaRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.mfa",
    name: "Interactive MFA",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    provides: ["mfa"],
  },
  definition: definePlugin((ctx) => {
    ctx.set("mfa", {
      show: (request: MfaRequest) => useMFAModalStore.getState().showMFA(request),
    })
  }),
}
