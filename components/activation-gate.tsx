"use client"

import { useState } from "react"
import { useActivationStore } from "@/lib/stores/activation"
import { isCapacitor } from "@/lib/native/platform"
import { getActivateUrl } from "@/lib/cookie"
import { useTranslation } from "@/lib/i18n/use-translation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * Web 端激活门禁（体验层；真正的强制在 /api/proxy 的 X-Activation 校验）。
 * 未激活时 children 不挂载：provider 初始化、公告/更新检查、数据请求
 * 全部不发生。Native 与本地开发（非 production 构建）直接放行。
 * token 被轮换后 proxy 返回 403 会清除本地凭证，本组件随之回落到激活页。
 */
export function ActivationGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const token = useActivationStore((s) => s.token)
  const hasHydrated = useActivationStore((s) => s.hasHydrated)
  const setToken = useActivationStore((s) => s.setToken)
  const [input, setInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<"invalid" | "network" | null>(null)

  if (isCapacitor() || process.env.NODE_ENV !== "production") {
    return <>{children}</>
  }
  // 水合完成前不渲染，避免已激活用户看到激活页闪烁
  if (!hasHydrated) return null
  if (token) return <>{children}</>

  const submit = async () => {
    const value = input.trim()
    if (!value || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(getActivateUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: value }),
      })
      if (res.ok) {
        setToken(value)
      } else if (res.status === 401) {
        setError("invalid")
      } else {
        setError("network")
      }
    } catch {
      setError("network")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("activation.title")}</CardTitle>
          <CardDescription>{t("activation.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <Input
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("activation.placeholder")}
              autoFocus
              autoComplete="off"
            />
            {error && (
              <p className="text-sm text-destructive">
                {error === "invalid" ? t("activation.invalid") : t("activation.networkError")}
              </p>
            )}
            <Button type="submit" disabled={submitting || !input.trim()}>
              {submitting ? t("activation.verifying") : t("activation.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
