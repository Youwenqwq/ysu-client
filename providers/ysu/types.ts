export type YSUMfaMethod = "sms" | "cpdaily" | "weixin";

const YSU_MFA_METHODS: readonly YSUMfaMethod[] = ["sms", "cpdaily", "weixin"];

export function isYSUMfaMethod(method: string): method is YSUMfaMethod {
  return (YSU_MFA_METHODS as readonly string[]).includes(method);
}

export function getYSUMfaMethods(): readonly YSUMfaMethod[] {
  return YSU_MFA_METHODS;
}
