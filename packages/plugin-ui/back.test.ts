import { afterEach, describe, expect, it, vi } from "vitest"
import { BACK_PRIORITY, registerBackHandler, requestBack, setNavigationBackHandler } from "./back"

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function layer(callback: () => void, priority: number) {
  const remove = registerBackHandler(callback, priority)
  cleanups.push(remove)
  return remove
}

describe("application back dispatch", () => {
  it("returns through nested modal, parent modal, page mode, then navigation", () => {
    const steps: string[] = []
    cleanups.push(setNavigationBackHandler(() => steps.push("route")))
    // React mounts descendants before ancestors; nesting must beat registration order.
    const inner = layer(() => {
      steps.push("inner")
      inner()
    }, BACK_PRIORITY.overlay + 1)
    const outer = layer(() => {
      steps.push("outer")
      outer()
    }, BACK_PRIORITY.overlay)
    const page = layer(() => {
      steps.push("page")
      page()
    }, BACK_PRIORITY.page)
    requestBack()
    expect(steps).toEqual(["inner"])
    requestBack()
    requestBack()
    requestBack()
    expect(steps).toEqual(["inner", "outer", "page", "route"])
  })

  it("consumes back while a busy modal refuses to close", () => {
    const navigate = vi.fn()
    cleanups.push(setNavigationBackHandler(navigate))
    let busy = true
    let open = true
    const remove = layer(() => {
      if (!busy) {
        open = false
        remove()
      }
    }, BACK_PRIORITY.overlay)
    requestBack(false)
    requestBack(false)
    expect(open).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
    busy = false
    requestBack()
    expect(open).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    requestBack()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it("cancels a gesture before leaving editing and ignores disposed layers", () => {
    const steps: string[] = []
    layer(() => steps.push("editing"), BACK_PRIORITY.page)
    const gesture = layer(() => {
      steps.push("gesture")
      gesture()
    }, BACK_PRIORITY.gesture)
    const disposed = layer(() => steps.push("stale overlay"), BACK_PRIORITY.overlay)
    disposed()
    requestBack()
    requestBack()
    expect(steps).toEqual(["gesture", "editing"])
  })

  it("returns from the most recently opened peer before the earlier one", () => {
    const steps: string[] = []
    layer(() => steps.push("earlier"), BACK_PRIORITY.overlay)
    const latest = layer(() => {
      steps.push("latest")
      latest()
    }, BACK_PRIORITY.overlay)
    requestBack()
    requestBack()
    expect(steps).toEqual(["latest", "earlier"])
  })
})
