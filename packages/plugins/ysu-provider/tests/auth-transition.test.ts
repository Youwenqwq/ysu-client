import { describe, expect, it } from "vitest"
import { createAuthTransitionQueue } from "../src/auth-transition"

describe("auth transition coordinator", () => {
  it("runs queued transitions serially", async () => {
    const { withAuthTransition } = createAuthTransitionQueue()
    const events: string[] = []
    const firstGate = Promise.withResolvers<void>()

    const first = withAuthTransition(async () => {
      events.push("first:start")
      await firstGate.promise
      events.push("first:end")
    })
    const second = withAuthTransition(async () => {
      events.push("second:start")
      events.push("second:end")
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(["first:start"])

    firstGate.resolve()
    await Promise.all([first, second])
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"])
  })

  it("waits for transitions already queued", async () => {
    const { waitForAuthTransition, withAuthTransition } = createAuthTransitionQueue()
    const gate = Promise.withResolvers<void>()
    const transition = withAuthTransition(async () => gate.promise)
    const idle = waitForAuthTransition()
    let settled = false
    void idle.then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)

    gate.resolve()
    await Promise.all([transition, idle])
    expect(settled).toBe(true)
  })

  it("isolates independent queue instances across provider contexts", async () => {
    const queueA = createAuthTransitionQueue()
    const queueB = createAuthTransitionQueue()
    const gateA = Promise.withResolvers<void>()

    const pendingA = queueA.withAuthTransition(() => gateA.promise)
    await expect(queueB.withAuthTransition(async () => "ok")).resolves.toBe("ok")

    gateA.resolve()
    await pendingA
  })
})
