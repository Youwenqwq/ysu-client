import { describe, expect, it } from "vitest"
import { appHistoryDepth, installBackHistory } from "./back-history"

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
