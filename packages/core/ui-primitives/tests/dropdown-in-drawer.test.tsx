import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const capturedRootProps: Array<Record<string, unknown>> = []

vi.mock("radix-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("radix-ui")>()
  return {
    ...actual,
    DropdownMenu: {
      ...actual.DropdownMenu,
      Root: (props: Record<string, unknown>) => {
        capturedRootProps.push(props)
        return null
      },
    },
  }
})

import { DropdownMenu } from "../src"

beforeEach(() => {
  capturedRootProps.length = 0
})

describe("DropdownMenu modal default", () => {
  it("defaults modal to false so nested menus inside Vaul Drawers never leak body pointer-events", () => {
    renderToStaticMarkup(<DropdownMenu>{null}</DropdownMenu>)
    expect(capturedRootProps).toHaveLength(1)
    expect(capturedRootProps[0]?.modal).toBe(false)
  })

  it("respects an explicit modal={true} override", () => {
    renderToStaticMarkup(<DropdownMenu modal={true}>{null}</DropdownMenu>)
    expect(capturedRootProps).toHaveLength(1)
    expect(capturedRootProps[0]?.modal).toBe(true)
  })
})
