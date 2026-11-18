import {
  definePlugin,
  isCapacitor,
  PLUGIN_API_VERSION,
  type ObservableSource,
  type PluginConfig,
} from "@orahako/sdk"
import { activationDictionary } from "./dictionary"
import { ActivationGate, type ActivationGateInject } from "./gate"
import { activationStore } from "./store"

export const ACTIVATION_PLUGIN_ID = "orahako.activation"
export const ACTIVATION_HEADER = "x-activation"
export const DEFAULT_VERIFY_ENDPOINT = "/api/activate"

export interface ActivationPluginConfig extends PluginConfig {
  readonly required?: boolean
  readonly verifyEndpoint?: string
}

export const activationConfigSchema = {
  type: "object",
  properties: {
    required: { type: "boolean" },
    verifyEndpoint: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const

function readNodeEnv(): string | undefined {
  const proc = (
    globalThis as { readonly process?: { readonly env?: Record<string, string | undefined> } }
  ).process
  return proc?.env?.NODE_ENV
}

export function resolveActivationRequired(configured: boolean | undefined): boolean {
  if (configured !== undefined) return configured
  return readNodeEnv() === "production"
}

export function resolveVerifyEndpoint(configured: string | undefined): string {
  const trimmed = configured?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : DEFAULT_VERIFY_ENDPOINT
}

function createHydrationBarrier(hydrated: ObservableSource<boolean>): {
  wait(): Promise<void>
  release(): void
} {
  let released = false
  const waiters = new Set<() => void>()

  const flush = () => {
    for (const resolve of waiters) {
      resolve()
    }
    waiters.clear()
  }

  const unsubscribe = hydrated.subscribe(() => {
    if (hydrated.getSnapshot()) {
      unsubscribe()
      flush()
    }
  })

  if (hydrated.getSnapshot()) {
    unsubscribe()
  }

  return {
    wait(): Promise<void> {
      if (released || hydrated.getSnapshot()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        waiters.add(resolve)
      })
    },
    release(): void {
      if (released) return
      released = true
      unsubscribe()
      flush()
    },
  }
}

export const activationPlugin = definePlugin({
  manifest: {
    id: ACTIVATION_PLUGIN_ID,
    name: "应用激活",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    providerIndependent: true,
    entry: "index.js",
    inject: ["slots", "i18n", "storage", "http"],
  },
  inject: ["slots", "i18n", "storage", "http"] as const,
  configSchema: activationConfigSchema,
  apply(ctx, config: ActivationPluginConfig = {}) {
    const required = resolveActivationRequired(config.required)
    const verifyEndpoint = resolveVerifyEndpoint(config.verifyEndpoint)
    const storeInstance = activationStore.create(ctx.storage)
    const hydrationBarrier = createHydrationBarrier(storeInstance.hydrated)

    ctx.effect(() => () => {
      hydrationBarrier.release()
      storeInstance.dispose()
    })

    ctx.i18n.register(activationDictionary)

    ctx.on("http/request", async (req) => {
      await hydrationBarrier.wait()
      const token = storeInstance.source.getSnapshot().token
      if (!token || token.length === 0) return undefined
      return {
        ...req,
        headers: {
          ...req.headers,
          [ACTIVATION_HEADER]: token,
        },
      }
    })

    ctx.on("http/response", async (resp) => {
      if (resp.status === 401 || resp.status === 403) {
        try {
          const detail = await resp.text()
          if (detail.includes("ACTIVATION_REQUIRED")) {
            storeInstance.actions.clearToken()
          }
        } catch {
          // Ignore unreadable bodies and preserve original response downstream.
        }
      }
      return undefined
    })

    ctx.slots.inject("shell.gate", () =>
      ctx.slots.register(
        {
          id: "activation-gate",
          slot: "shell.gate",
          dictionary: activationDictionary,
          store: storeInstance,
          inject: (): ActivationGateInject => ({
            required,
            verifyEndpoint,
            isNative: isCapacitor(),
            hooks: {
              hydrated: storeInstance.hydrated,
            },
          }),
        },
        ActivationGate
      )
    )
  },
})
