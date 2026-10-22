import policy from "../../harmony/security-policy.json"

export function assertHarmonyRequest(
  method: string,
  input: string,
  body?: string,
  depth = 0
): void {
  if (depth > 3 || input.length > 8192) throw new Error("安全策略禁止此请求")
  const parsed = new URL(input)
  if (parsed.username || parsed.password || parsed.port || /[%\\]/.test(parsed.pathname)) {
    throw new Error("安全策略禁止此请求")
  }
  const allowed = policy.routes.some(
    (route) =>
      route.origin === parsed.origin && route.method === method && route.path === parsed.pathname
  )
  if (!allowed) throw new Error("仅允许直接访问已审核的学校认证、查询、评教与签到接口")
  if (
    parsed.pathname === "/jwapp/sys/emaphome/appShow.do" &&
    !policy.appIds.includes(parsed.searchParams.get("id") ?? "")
  ) {
    throw new Error("未审核的教务应用")
  }
  // Authentication must not send service tickets to an unreviewed callback.
  const form = new URLSearchParams(body)
  for (const params of [parsed.searchParams, form]) {
    for (const key of ["service", "success"]) {
      const services = params.getAll(key)
      if (services.length > 1) throw new Error("安全策略禁止重复回调参数")
      const service = services[0]
      if (service) assertHarmonyRequest("GET", service, undefined, depth + 1)
    }
  }
}
