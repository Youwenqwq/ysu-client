import { describe, expect, it, vi } from "vitest"
import type { PluginHttpService } from "@orahako/plugin-sdk"
import { createTestContext } from "./test-context"
import { PluginI18nRegistry } from "@/plugins/official/runtime/registries/i18n"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { ProviderPluginRegistry } from "@/plugins/official/runtime/provider/registry"
import { YSUProvider } from "./ysu-provider"
import { definition, manifest } from "./index"

function createHttpService() {
  const labelers: Array<(url: string) => string | undefined> = []
  const service: PluginHttpService = {
    send: async () => {
      throw new Error("unexpected request")
    },
    activity: {
      getSnapshot: () => ({ active: [], history: [], session: null, revision: 0 }),
      subscribe: () => () => {},
      beginRequest: () => () => {},
      registerLabeler: (labeler) => {
        labelers.push(labeler)
        return () => {
          const index = labelers.indexOf(labeler)
          if (index >= 0) labelers.splice(index, 1)
        }
      },
      registerClassifier: () => () => {},
    },
  }
  return { service, labelers }
}

describe("YSU provider plugin", () => {
  it("does not register its provider until the plugin starts", () => {
    expect(new ProviderPluginRegistry().hasProvider("ysu")).toBe(false)
  })

  it("registers and revokes the YSU provider when started and stopped", async () => {
    const providers = new ProviderPluginRegistry()
    const i18n = new PluginI18nRegistry()
    const { service: http, labelers } = createHttpService()
    const runtime = new PluginRuntime()
    runtime.context.set("providers", providers)
    runtime.context.set("i18n", i18n)
    runtime.context.set("http", http)
    const services = createTestContext().ctx
    runtime.context.set("session", services.session)
    runtime.context.set("storage", services.storage)
    runtime.context.set("query", services.query)
    runtime.context.set("native", services.native)
    runtime.context.set("mfa", services.mfa)
    runtime.register(manifest, definition, "builtin")
    runtime.start(manifest.id)
    await vi.waitFor(() => expect(providers.hasProvider("ysu")).toBe(true))
    expect(providers.createProvider("ysu")).toBeInstanceOf(YSUProvider)
    expect(labelers).toHaveLength(1)
    expect(i18n.translate(manifest.id, "networkActivity.ysu.cas", "zh")).toBe("统一认证")

    runtime.stop(manifest.id)
    expect(providers.hasProvider("ysu")).toBe(false)
    expect(i18n.translate(manifest.id, "networkActivity.ysu.cas", "zh")).toBe(
      "networkActivity.ysu.cas"
    )
  })
})
