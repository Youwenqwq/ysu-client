"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Loader2 } from "lucide-react"
import type {
  NetworkActivityCategory,
  NetworkActivitySnapshot,
  PluginHttpActivityService,
} from "@orahako/plugin-sdk"
import { useTranslation } from "@orahako/plugin-ui/hooks"

const SUMMARY_VISIBLE_MS = 4_000
const TICK_MS = 100
const MAX_VISIBLE_REQUESTS = 3

const EMPTY_SNAPSHOT: NetworkActivitySnapshot = { active: [], session: null, revision: 0 }

const CATEGORY_KEYS: Record<NetworkActivityCategory, string> = {
  auth: "networkActivity.category.auth",
  academic: "networkActivity.category.academic",
  mobile: "networkActivity.category.mobile",
  "one-stop": "networkActivity.category.oneStop",
  campus: "networkActivity.category.campus",
  payment: "networkActivity.category.payment",
  wechat: "networkActivity.category.wechat",
  other: "networkActivity.category.other",
}

function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms)
  if (clamped < 1_000) return `${Math.max(1, Math.round(clamped))}ms`
  if (clamped < 10_000) return `${(clamped / 1_000).toFixed(1)}s`
  return `${Math.round(clamped / 1_000)}s`
}

type Translate = (key: string, params?: Record<string, string | number>) => string

function translateLabel(
  t: Translate,
  label: string | undefined,
  category: NetworkActivityCategory
): string {
  if (label) {
    const text = t(label)
    if (text !== label) return text
  }
  return t(CATEGORY_KEYS[category])
}

function getServerSnapshot(): NetworkActivitySnapshot {
  return EMPTY_SNAPSHOT
}

export function NetworkActivityStrip({ activity }: { activity: PluginHttpActivityService }) {
  const { t } = useTranslation()
  const snapshot = useSyncExternalStore(activity.subscribe, activity.getSnapshot, getServerSnapshot)
  const hasActive = snapshot.active.length > 0
  const [now, setNow] = useState(() =>
    typeof performance === "undefined" ? Date.now() : performance.now()
  )
  const [summaryVisible, setSummaryVisible] = useState(false)
  const wasActive = useRef(false)

  useEffect(() => {
    if (!hasActive) return
    setNow(typeof performance === "undefined" ? Date.now() : performance.now())
    const timer = setInterval(
      () => setNow(typeof performance === "undefined" ? Date.now() : performance.now()),
      TICK_MS
    )
    return () => clearInterval(timer)
  }, [hasActive])

  useEffect(() => {
    if (hasActive) {
      wasActive.current = true
      setSummaryVisible(false)
      return
    }
    if (!wasActive.current) return
    wasActive.current = false
    setSummaryVisible(true)
    const timer = setTimeout(() => setSummaryVisible(false), SUMMARY_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [hasActive])

  if (!hasActive && !summaryVisible) return null

  const session = snapshot.session
  const showSummary = !hasActive && summaryVisible && session !== null && session.count > 0
  const visible = snapshot.active.slice(0, MAX_VISIBLE_REQUESTS)
  const hidden = snapshot.active.length - visible.length

  return (
    <div className="pointer-events-none absolute inset-x-0 top-full z-20 h-0">
      <div className="absolute inset-x-0 top-0 flex h-5 items-center gap-2 overflow-hidden border-b border-border/20 bg-background/50 px-4 text-[11px] leading-none text-muted-foreground backdrop-blur-[2px] md:px-6">
        {hasActive ? (
          <>
            <Loader2 className="size-3 shrink-0 animate-spin" />
            <span className="shrink-0 font-medium">{t("networkActivity.live")}</span>
            <span className="flex min-w-0 items-center gap-2 overflow-hidden">
              {visible.map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex shrink-0 items-center gap-1 tabular-nums"
                >
                  <span className="truncate">{translateLabel(t, entry.label, entry.category)}</span>
                  <span className="text-foreground/60">
                    {formatDuration(now - entry.startedAt)}
                  </span>
                </span>
              ))}
              {hidden > 0 && <span className="shrink-0 tabular-nums">+{hidden}</span>}
            </span>
          </>
        ) : showSummary ? (
          <span className="truncate tabular-nums">
            {t("networkActivity.summary", {
              count: session.count,
              total: formatDuration(session.totalMs),
              slowest: translateLabel(t, session.slowestLabel, session.slowestCategory ?? "other"),
              duration: formatDuration(session.slowestMs),
            })}
            {session.failed > 0 && t("networkActivity.failed", { count: session.failed })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
