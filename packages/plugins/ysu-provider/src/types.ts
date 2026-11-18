export type YSUMfaMethod = "sms" | "cpdaily" | "weixin"

const YSU_MFA_METHODS: readonly YSUMfaMethod[] = ["sms", "cpdaily", "weixin"]

export function isYSUMfaMethod(method: string): method is YSUMfaMethod {
  return method === "sms" || method === "cpdaily" || method === "weixin"
}

export function getYSUMfaMethods(): readonly YSUMfaMethod[] {
  return YSU_MFA_METHODS
}
