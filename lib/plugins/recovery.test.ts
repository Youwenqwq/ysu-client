import { describe, expect, it } from "vitest"
import { nextPluginBootState, type PluginRecoveryState } from "./recovery"

const starting: PluginRecoveryState = {
  phase: "starting",
  build: "100",
  crashStreak: 0,
  safeMode: false,
}

describe("nextPluginBootState", () => {
  it("enters safe mode after repeated crashes in the same build", () => {
    const second = nextPluginBootState(starting, "100")
    expect(second).toMatchObject({ crashStreak: 1, safeMode: false })
    const third = nextPluginBootState(second, "100")
    expect(third).toMatchObject({ crashStreak: 2, safeMode: true })
  })

  it("resets crash history after an app update", () => {
    expect(nextPluginBootState({ ...starting, crashStreak: 4 }, "101")).toMatchObject({
      crashStreak: 0,
      safeMode: false,
    })
  })

  it("does not treat a normal restart as a crash", () => {
    expect(nextPluginBootState({ ...starting, phase: "ready" }, "100").safeMode).toBe(false)
  })
})
