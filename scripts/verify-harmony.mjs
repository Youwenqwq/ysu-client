import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const raw = join(root, "harmony/entry/src/main/resources/rawfile")
const www = join(raw, "www")
const policyBytes = readFileSync(join(root, "harmony/security-policy.json"))
if (!policyBytes.equals(readFileSync(join(raw, "security-policy.json")))) throw new Error("Packaged policy differs from reviewed source")
const policy = JSON.parse(policyBytes)
if (policy.routes.some((route) => !/^https:\/\/(cer|jwxt|epay|ehall)\.ysu\.edu\.cn$/.test(route.origin) ||
  !["GET", "POST"].includes(route.method) || /bysc|xgksrwxs|recharge|payment/i.test(route.path))) {
  throw new Error("Unexpected host or modifying action in request policy")
}
const mobileRoutes = [
  ["GET", "/jwmobile/auth/index"],
  ["GET", "/jwmobile/biz/v410/"],
  ["POST", "/jwmobile/biz/v410/lesson/queryCurrentLesson"],
  ["POST", "/jwmobile/biz/v410/signin/detail"],
  ["POST", "/jwmobile/biz/v410/signin/querySigninDetail"],
  ["POST", "/jwmobile/biz/v410/signin/sign"],
]
if (policy.routes.some((route) => /\/jwmobile(?:\/|$)|signin/i.test(route.path) &&
  (route.origin !== "https://jwxt.ysu.edu.cn" ||
    !mobileRoutes.some(([method, path]) => route.method === method && route.path === path))) ||
  mobileRoutes.some(([method, path]) => !policy.routes.some((route) =>
    route.origin === "https://jwxt.ysu.edu.cn" && route.method === method && route.path === path))) {
  throw new Error("Unexpected or missing mobile sign-in endpoint in request policy")
}
let pages = 0
let bytes = 0
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) inspect(path)
    else {
      const data = readFileSync(path)
      bytes += data.length
      if (entry.name.endsWith(".html")) {
        const html = data.toString("utf8")
        if (!html.includes('http-equiv="Content-Security-Policy"') ||
          !html.includes("connect-src 'self' data: blob:") ||
          !html.includes("form-action 'none'") || !html.includes("frame-src 'none'")) {
          throw new Error(`Missing packaged network restrictions: ${path}`)
        }
        pages++
      }
    }
  }
}
inspect(www)
const login = readFileSync(join(www, "login/index.html"), "utf8")
if (!login.includes('name="ysu-platform" content="harmony"')) throw new Error("Wrong application build mode")
for (const page of ["dashboard/schedule/index.html", "dashboard/grades/index.html", "dashboard/exams/index.html"]) {
  if (!existsSync(join(www, page))) throw new Error(`Missing core route ${page}`)
}
const result = {
  mode: "harmony-local-only", policySha256: createHash("sha256").update(policyBytes).digest("hex"),
  reviewedRoutes: policy.routes.length, protectedHtmlPages: pages, webResourceBytes: bytes,
}
writeFileSync(join(root, "harmony/resource-verification.json"), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
