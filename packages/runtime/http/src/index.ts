import {
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  runHttpRequestPipeline,
  runHttpResponsePipeline,
  trackPluginRegistration,
  type Context,
  type HttpRequest,
  type HttpResponse,
  type HttpValuePipelineContext,
  type NetworkActivityOutcome,
  type NetworkActivitySink,
  type NetworkActivitySnapshot,
  type ObservableSource,
  type PluginHttpService,
  type ScopedPluginService,
} from "@orahako/sdk"
import {
  HttpActivityRecorder,
  NetworkActivityRuntime,
  type ActivityClassifier,
  type ActivityLabeler,
  type FinishRequest,
} from "./activity"
import {
  DEFAULT_PROXY_PATH,
  DEFAULT_TIMEOUT_MS,
  executeStatelessTransport,
  executeTransportHop,
  MAX_REDIRECTS,
  type TransportOptions,
} from "./transport"

export {
  collectCookies,
  cookieEntryFromJSON,
  extractSetCookies,
  fetchWithCookieJar,
  headerSingle,
  installCookies,
  isRequestScopedCookie,
  mergeScopedCookies,
  SimpleCookieJar,
  splitSetCookie,
  type CookieJar,
  type CookiePredicate,
} from "@orahako/sdk"

export {
  DEFAULT_PROXY_PATH,
  DEFAULT_TIMEOUT_MS,
  executeStatelessTransport,
  executeTransportHop,
  MAX_REDIRECTS,
  type TransportOptions,
}

export {
  HttpActivityRecorder,
  NetworkActivityRuntime,
  type ActivityClassifier,
  type ActivityLabeler,
  type FinishRequest,
}

export type HttpRuntimeConfig = {
  readonly proxyPath?: string
}

export interface HttpServiceOptions extends TransportOptions {
  readonly ctx?: HttpValuePipelineContext
}

function beginActivity(
  sink: NetworkActivitySink | undefined,
  req: HttpRequest
): (outcome: NetworkActivityOutcome) => void {
  let finish: ((outcome?: NetworkActivityOutcome) => void) | undefined
  try {
    finish = sink?.beginRequest(req.url, req.method)
  } catch {
    finish = undefined
  }
  return (outcome) => {
    try {
      finish?.(outcome)
    } catch {
      // Instrumentation must never break the transport.
    }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

export class StatelessHttpService implements ScopedPluginService<PluginHttpService> {
  readonly recorder = new HttpActivityRecorder()

  constructor(private readonly options: HttpServiceOptions = {}) {}

  dispose(): void {
    this.recorder.dispose()
  }

  [PLUGIN_SERVICE_SCOPE](consumerCtx: Context): PluginHttpService {
    const pipelineCtx: HttpValuePipelineContext = this.options.ctx ?? consumerCtx

    const scopedSubscribe = (listener: () => void): (() => void) =>
      trackPluginRegistration(consumerCtx, () => this.recorder.subscribe(listener))

    const state: ObservableSource<NetworkActivitySnapshot> = {
      getSnapshot: this.recorder.getSnapshot,
      subscribe: scopedSubscribe,
    }

    return {
      send: async (request: HttpRequest): Promise<HttpResponse> => {
        const effectiveRequest = await runHttpRequestPipeline(pipelineCtx, request)
        const finish = beginActivity(this.recorder, effectiveRequest)
        try {
          const response = await executeStatelessTransport(effectiveRequest, this.options)
          const finalResponse = await runHttpResponsePipeline(
            pipelineCtx,
            response,
            effectiveRequest
          )
          finish("ok")
          return finalResponse
        } catch (error) {
          finish(isAbortError(error) ? "aborted" : "error")
          throw error
        }
      },
      activity: {
        state,
        getSnapshot: this.recorder.getSnapshot,
        beginRequest: this.recorder.beginRequest,
        subscribe: scopedSubscribe,
        registerLabeler: (labeler) =>
          trackPluginRegistration(consumerCtx, () => this.recorder.registerLabeler(labeler)),
        registerClassifier: (classifier) =>
          trackPluginRegistration(consumerCtx, () => this.recorder.registerClassifier(classifier)),
      },
    }
  }
}

export const httpRuntimePlugin = definePlugin<readonly [], HttpRuntimeConfig>({
  manifest: {
    id: "orahako.runtime.http",
    name: "Platform HTTP transport",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    provides: ["http"],
  },
  configSchema: {
    type: "object",
    properties: {
      proxyPath: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
  apply(ctx, config: HttpRuntimeConfig) {
    const service = new StatelessHttpService({
      ctx,
      ...(config.proxyPath !== undefined ? { proxyPath: config.proxyPath } : {}),
    })
    ctx.on("dispose", () => service.dispose())
    ctx.set("http", service)
  },
})
