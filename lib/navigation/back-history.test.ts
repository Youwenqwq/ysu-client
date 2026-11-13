import { beforeEach, describe, expect, it } from "vitest"
import { appHistoryDepth, backFallback, installBackHistory } from "./back-history"
import { usePluginRouteStore } from "../stores/plugin-route"

function browserHistory() {
  const entries: unknown[] = [null]
  let index = 0
  return {
    get state() {
      return entries[index]
    },
    pushState(state: unknown) {
      entries.splice(++index, entries.length, state)
    },
    replaceState(state: unknown) {
      entries[index] = state
    },
    back() {
      if (index > 0) index--
    },
  }
}

describe("app-owned history", () => {
  it("keeps replacements at the same depth and restores the prior depth on back", () => {
    const history = browserHistory()
    const dispose = installBackHistory(history)
    try {
      expect(appHistoryDepth(history)).toBe(0)
      history.replaceState({ route: "settings deep link" })
      expect(appHistoryDepth(history)).toBe(0)
      history.pushState({ route: "schedule" })
      history.replaceState({ route: "grades" })
      expect(appHistoryDepth(history)).toBe(1)
      history.back()
      expect(appHistoryDepth(history)).toBe(0)
      history.pushState({ route: "new branch" })
      expect(appHistoryDepth(history)).toBe(1)
    } finally {
      dispose()
    }
  })

  it("does not stamp later entries through a framework wrapper after disposal", () => {
    const history = browserHistory()
    const dispose = installBackHistory(history)
    const wrappedPush = history.pushState
    history.pushState = (state) => wrappedPush(state)
    dispose()
    const outsideState = { route: "another owner" }
    history.pushState(outsideState)
    expect(history.state).toBe(outsideState)
    expect(appHistoryDepth(history)).toBe(0)
  })
})

describe("back fallback destinations", () => {
  beforeEach(() => {
    usePluginRouteStore.setState({ current: undefined })
  })

  it("exits on the dashboard root and never falls back to login", () => {
    expect(backFallback("/dashboard", "/home")).toBeNull()
    expect(backFallback("/login", "/home")).toBeNull()
  })

  it("returns to the live plugin home or the deterministic primary page", () => {
    expect(backFallback("/dashboard/plugin", "/primary/home")).toBe("/primary/home")
    usePluginRouteStore.setState({
      current: {
        pluginId: "org.other.grades",
        pageId: "detail",
        title: "detail",
        parent: "index",
      },
    })
    expect(backFallback("/dashboard/plugin", "/primary/home")).toBe(
      "/dashboard/plugin/?plugin=org.other.grades&page=index"
    )
  })

  it("does not navigate away from a plugin home page", () => {
    usePluginRouteStore.setState({
      current: {
        pluginId: "org.other.overview",
        pageId: "index",
        title: "overview",
        primary: true,
      },
    })
    expect(backFallback("/dashboard/plugin", "/primary/home")).toBeNull()
  })

  it("leaves a non-primary plugin root instead of replacing the current URL", () => {
    usePluginRouteStore.setState({
      current: {
        pluginId: "org.other.grades",
        pageId: "index",
        title: "grades",
      },
    })
    expect(backFallback("/dashboard/plugin", "/primary/home")).toBe("/primary/home")
  })

  it("keeps the settings breadcrumb hierarchy", () => {
    expect(backFallback("/dashboard/me/settings/widgets", "/home")).toBe("/dashboard/me/settings")
    expect(backFallback("/dashboard/me/avatar", "/home")).toBe("/dashboard/me")
    expect(backFallback("/dashboard/ecard", "/home")).toBe("/home")
  })
})
