import { describe, expect, it } from "vitest"
import {
  isJavaScriptPackagePath,
  isSafePackagePath,
  packageDirectory,
  resolveRelativePackagePath,
} from "./package-path"

describe("isSafePackagePath", () => {
  it.each(["manifest.json", "dist/index.js", "assets/icons/icon-48.png", ".well-known/x"])(
    "accepts %s",
    (path) => {
      expect(isSafePackagePath(path)).toBe(true)
    }
  )

  it.each([
    "",
    "/etc/passwd",
    "../escape.js",
    "dist/../../escape.js",
    "dist/../index.js",
    "./index.js",
    "dist//index.js",
    "dist\\index.js",
    "C:/windows/system32",
    "dist/index.js\u0000",
    "文件.js",
  ])("rejects %s", (path) => {
    expect(isSafePackagePath(path)).toBe(false)
  })

  it("rejects paths longer than the limit", () => {
    expect(isSafePackagePath(`${"a".repeat(256)}.js`)).toBe(false)
  })
})

describe("isJavaScriptPackagePath", () => {
  it.each(["index.js", "dist/chunk.mjs", "UPPER.JS"])("accepts %s", (path) => {
    expect(isJavaScriptPackagePath(path)).toBe(true)
  })

  it.each(["index.jsx", "styles.css", "data.json", "module"])("rejects %s", (path) => {
    expect(isJavaScriptPackagePath(path)).toBe(false)
  })
})

describe("packageDirectory", () => {
  it("returns the containing directory", () => {
    expect(packageDirectory("dist/index.js")).toBe("dist")
    expect(packageDirectory("index.js")).toBe("")
  })
})

describe("resolveRelativePackagePath", () => {
  it("resolves files next to the importer", () => {
    expect(resolveRelativePackagePath("dist/index.js", "./utils.js")).toBe("dist/utils.js")
    expect(resolveRelativePackagePath("dist/index.js", "../shared.js")).toBe("shared.js")
    expect(resolveRelativePackagePath("index.js", "./nested/../helper.js")).toBe("helper.js")
  })

  it("rejects non-relative specifiers", () => {
    expect(resolveRelativePackagePath("index.js", "react")).toBeUndefined()
    expect(resolveRelativePackagePath("index.js", "/abs.js")).toBeUndefined()
  })

  it("rejects paths escaping the package root", () => {
    expect(resolveRelativePackagePath("index.js", "../escape.js")).toBeUndefined()
    expect(resolveRelativePackagePath("dist/index.js", "../../escape.js")).toBeUndefined()
  })

  it("rejects unsafe relative segments", () => {
    expect(resolveRelativePackagePath("index.js", "./a\\b.js")).toBeUndefined()
    expect(resolveRelativePackagePath("index.js", "./文件.js")).toBeUndefined()
  })
})
