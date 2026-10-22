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
    <div className="relative flex min-h-dvh items-center justify-center p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, var(--edge) 0 2px, transparent 2px 14px)",
        }}
      />
      <div className="w-full max-w-sm">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="hud-label">ACCESS // GATE</span>
            <span className="font-heading text-2xl leading-none font-bold tracking-tight">
              YSU TERMINAL
            </span>
          </div>
          <span className="mb-1 flex items-center gap-1.5 border border-edge/40 px-1.5 py-0.5 font-mono text-[0.6rem] tracking-wider text-muted-foreground">
            <span className="size-1.5 bg-hazard" />
            LOCKED
          </span>
        </div>
        <Card className="w-full">
          <CardHeader className="border-b-2 border-edge/20 pb-4">
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
                className="font-mono"
                autoFocus
                autoComplete="off"
              />
              {error && (
                <p className="flex items-start gap-2 border-l-[3px] border-destructive bg-destructive/10 px-2 py-1.5 text-sm text-destructive">
                  <span aria-hidden="true" className="font-mono text-xs leading-5">
                    ERR
                  </span>
                  <span>
                    {error === "invalid" ? t("activation.invalid") : t("activation.networkError")}
                  </span>
                </p>
              )}
              <Button type="submit" disabled={submitting || !input.trim()}>
                {submitting ? t("activation.verifying") : t("activation.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
