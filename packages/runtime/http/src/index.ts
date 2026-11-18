import {
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type Context,
  type HttpRequest,
  type HttpResponse,
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
  collectCookies,
  cookieEntryFromJSON,
  extractSetCookies,
  headerSingle,
  installCookies,
  isRequestScopedCookie,
  mergeScopedCookies,
  SimpleCookieJar,
  splitSetCookie,
  stripBodyHeaders,
  type CookieJar,
  type CookiePredicate,
} from "./cookie"
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
  DEFAULT_PROXY_PATH,
  DEFAULT_TIMEOUT_MS,
  executeStatelessTransport,
  executeTransportHop,
  extractSetCookies,
  headerSingle,
  HttpActivityRecorder,
  installCookies,
  MAX_REDIRECTS,
  NetworkActivityRuntime,
  SimpleCookieJar,
  splitSetCookie,
  type ActivityClassifier,
  type ActivityLabeler,
  type CookieJar,
  type CookiePredicate,
  type FinishRequest,
  type TransportOptions,
}

export type HttpRuntimeConfig = {
  readonly proxyPath?: string
}

export interface HttpServiceOptions extends TransportOptions {
  readonly ctx?: Pick<Context, "waterfall">
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
    const waterfallCtx: Pick<Context, "waterfall"> | undefined =
      this.options.ctx ?? (typeof consumerCtx.waterfall === "function" ? consumerCtx : undefined)

    const scopedSubscribe = (listener: () => void): (() => void) =>
      trackPluginRegistration(consumerCtx, () => this.recorder.subscribe(listener))

    const state: ObservableSource<NetworkActivitySnapshot> = {
      getSnapshot: this.recorder.getSnapshot,
      subscribe: scopedSubscribe,
    }

    return {
      send: async (request: HttpRequest): Promise<HttpResponse> => {
        const effectiveRequest = waterfallCtx
          ? await waterfallCtx.waterfall("http/request", request)
          : request
        const finish = beginActivity(this.recorder, effectiveRequest)
        try {
          const response = await executeStatelessTransport(effectiveRequest, this.options)
          const finalResponse = waterfallCtx
            ? await waterfallCtx.waterfall("http/response", response, effectiveRequest)
            : response
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

function buildJarHopHeaders(
  headers: Readonly<Record<string, string>> | undefined,
  cookieHeader: string
): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === "cookie") continue
    out[key] = value
  }
  if (cookieHeader) {
    out["Cookie"] = cookieHeader
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Executes an `HttpRequest` with a `CookieJar` by sending manual redirect hops
 * (`maxRedirects = 10`) through `http.send(...)`. Every hop captures `302`
 * `Set-Cookie` headers into `jar` while flowing through `http/request`,
 * `http/response`, and `http.activity`.
 */
export async function fetchWithCookieJar(
  http: PluginHttpService,
  jar: CookieJar,
  request: HttpRequest
): Promise<HttpResponse> {
  let currentUrl = request.url
  let currentMethod = request.method
  let currentBody = request.body
  let currentHeaders = request.headers

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const jarCookies = await jar.getCookieString(currentUrl)
    const cookieHeader = mergeScopedCookies(jarCookies, currentUrl, request.cookies)
    const hopHeaders = buildJarHopHeaders(currentHeaders, cookieHeader)

    const resp = await http.send({
      method: currentMethod,
      url: currentUrl,
      ...(hopHeaders !== undefined ? { headers: hopHeaders } : {}),
      ...(currentBody !== undefined ? { body: currentBody } : {}),
      redirect: "manual",
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
      ...(request.responseType !== undefined ? { responseType: request.responseType } : {}),
      ...(request.proxyTargetInHeader !== undefined
        ? { proxyTargetInHeader: request.proxyTargetInHeader }
        : {}),
    })

    for (const sc of extractSetCookies(resp.headers)) {
      if (!isRequestScopedCookie(request, sc)) {
        await jar.setCookie(sc, currentUrl, { ignoreError: true })
      }
    }

    if (request.redirect === "manual") {
      return resp
    }

    if (resp.status < 300 || resp.status >= 400) {
      return resp
    }

    const location = headerSingle(resp.headers, "location")
    if (!location) {
      return resp
    }

    if (hop === MAX_REDIRECTS) {
      break
    }

    currentUrl = new URL(location, currentUrl).toString()
    if (
      resp.status === 303 ||
      ((resp.status === 301 || resp.status === 302) && currentMethod === "POST")
    ) {
      currentMethod = "GET"
      currentBody = undefined
      currentHeaders = stripBodyHeaders(currentHeaders)
    }
  }

  throw new Error(`Exceeded max redirects (${MAX_REDIRECTS}) for ${request.url}`)
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
