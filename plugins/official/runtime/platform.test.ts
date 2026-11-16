import { afterEach, describe, expect, it, vi } from "vitest"
import type { Context } from "@cordisjs/core"
import { PLUGIN_SERVICE_SCOPE, type PluginHttpService } from "@orahako/plugin-sdk"
import { StatelessHttpService } from "./platform"

/** Minimal Cordis context: registrations are released when dispose runs. */
function createScope() {
  const listeners = new Set<() => void>()
  const ctx = {
    on: (_event: "dispose", listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  } as unknown as Context
  return {
    ctx,
    dispose: () => {
      for (const listener of Array.from(listeners)) listener()
      listeners.clear()
    },
  }
}

function response(): Response {
  return new Response("", { status: 200, headers: { "x-proxy-status": "200" } })
}

function activate(service: StatelessHttpService) {
  const scope = createScope()
  const http = service[PLUGIN_SERVICE_SCOPE](scope.ctx)
  return { scope, http }
}

describe("StatelessHttpService activity ownership", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps activity isolated between service instances", async () => {
    const first = new StatelessHttpService()
    const second = new StatelessHttpService()
    const firstScope = activate(first)
    const secondScope = activate(second)
    try {
      vi.stubGlobal("fetch", vi.fn(async () => response()))

      await firstScope.http.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do",
        redirect: "manual",
      })

      expect(firstScope.http.activity.getSnapshot().session).toMatchObject({ count: 1 })
      expect(secondScope.http.activity.getSnapshot()).toEqual({
        active: [],
        history: [],
        session: null,
        revision: 0,
      })
    } finally {
      first.dispose()
      second.dispose()
      firstScope.scope.dispose()
      secondScope.scope.dispose()
    }
  })

  it("starts a replacement service with no inherited labelers, classifiers or activity", async () => {
    const replaced = new StatelessHttpService()
    const replacement = new StatelessHttpService()
    const replacedScope = activate(replaced)
    const replacementScope = activate(replacement)
    const replacedHttp = replacedScope.http
    const replacementHttp = replacementScope.http
    try {
      vi.stubGlobal("fetch", vi.fn(async () => response()))

      const oldListener = vi.fn()
      replacedHttp.activity.subscribe(oldListener)
      replacedHttp.activity.registerClassifier((url) =>
        url.includes("/pjapp/") ? "academic" : undefined
      )
      replacedHttp.activity.registerLabeler((url) =>
        url.includes("/pjapp/") ? "networkActivity.test.label" : undefined
      )

      await replacedHttp.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/jwapp/sys/pjapp/api/wdpj/getPjlx.do",
        redirect: "manual",
      })
      const recorded = replacedHttp.activity.getSnapshot()
      expect(recorded.history[0]).toMatchObject({
        category: "academic",
        label: "networkActivity.test.label",
      })

      replaced.dispose()

      expect(replacementHttp.activity.getSnapshot()).toEqual({
        active: [],
        history: [],
        session: null,
        revision: 0,
      })

      const replacementListener = vi.fn()
      replacementHttp.activity.subscribe(replacementListener)
      await replacementHttp.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/jwapp/sys/pjapp/api/wdpj/getPjlx.do",
        redirect: "manual",
      })

      const replacementRecord = replacementHttp.activity.getSnapshot().history[0]
      expect(replacementRecord).toMatchObject({ category: "other", outcome: "ok" })
      expect(replacementRecord?.label).toBeUndefined()
      expect(replacementListener).toHaveBeenCalled()
      expect(oldListener).toHaveBeenCalledTimes(2)
    } finally {
      replaced.dispose()
      replacement.dispose()
      replacedScope.scope.dispose()
      replacementScope.scope.dispose()
    }
  })

  it("releases consumer registrations when their plugin scope is disposed", async () => {
    const service = new StatelessHttpService()
    const scope = createScope()
    const http: PluginHttpService = service[PLUGIN_SERVICE_SCOPE](scope.ctx)
    try {
      vi.stubGlobal("fetch", vi.fn(async () => response()))

      const listener = vi.fn()
      http.activity.subscribe(listener)
      http.activity.registerClassifier(() => "academic")
      http.activity.registerLabeler(() => "networkActivity.test.label")

      scope.dispose()

      await http.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/jwapp/sys/pjapp/api/wdpj/getPjlx.do",
        redirect: "manual",
      })

      const snapshot = http.activity.getSnapshot()
      expect(listener).not.toHaveBeenCalled()
      expect(snapshot.history[0]).toMatchObject({ category: "other" })
      expect(snapshot.history[0]?.label).toBeUndefined()
    } finally {
      service.dispose()
    }
  })
})
