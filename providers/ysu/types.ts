import { isHarmony } from "@/lib/native/harmony"

export type YSUMfaMethod = "sms" | "cpdaily" | "weixin"

const YSU_MFA_METHODS: readonly YSUMfaMethod[] = ["sms", "cpdaily", "weixin"]

export function isYSUMfaMethod(method: string): method is YSUMfaMethod {
  return getYSUMfaMethods().includes(method as YSUMfaMethod)
}

export function getYSUMfaMethods(): readonly YSUMfaMethod[] {
  return isHarmony() ? ["sms", "cpdaily"] : YSU_MFA_METHODS
}
