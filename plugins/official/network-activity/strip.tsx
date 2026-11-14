"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Loader2 } from "lucide-react"
import type {
  NetworkActivityCategory,
  NetworkActivityOutcome,
  NetworkActivitySnapshot,
  PluginHttpActivityService,
} from "@orahako/plugin-sdk"
import { cn } from "@orahako/plugin-ui/components"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import { useActivitySettings } from "./state"

const SUMMARY_VISIBLE_MS = 4_000
const TICK_MS = 100
const MAX_VISIBLE_REQUESTS = 3

const EMPTY_SNAPSHOT: NetworkActivitySnapshot = {
  active: [],
  history: [],
  session: null,
  revision: 0,
}

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

const STATUS_KEYS: Record<NetworkActivityOutcome, string> = {
  ok: "networkActivity.status.ok",
  error: "networkActivity.status.error",
  aborted: "networkActivity.status.aborted",
}

const STATUS_CLASS: Record<NetworkActivityOutcome, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  aborted: "text-amber-600 dark:text-amber-400",
}

function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms)
  if (clamped < 1_000) return `${Math.max(1, Math.round(clamped))}ms`
  if (clamped < 10_000) return `${(clamped / 1_000).toFixed(1)}s`
  return `${Math.round(clamped / 1_000)}s`
}

function formatOffset(ms: number): string {
  return `+${(Math.max(0, ms) / 1_000).toFixed(1)}s`
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

interface FlowRow {
  id: number
  category: NetworkActivityCategory
  label?: string
  startedAt: number
  durationMs: number
  outcome?: NetworkActivityOutcome
}

function buildFlow(snapshot: NetworkActivitySnapshot, now: number): FlowRow[] {
  const completed = snapshot.history.map((record) => ({
    id: record.id,
    category: record.category,
    label: record.label,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    outcome: record.outcome,
  }))
  const running = snapshot.active.map((entry) => ({
    id: entry.id,
    category: entry.category,
    label: entry.label,
    startedAt: entry.startedAt,
    durationMs: Math.max(0, now - entry.startedAt),
    outcome: undefined,
  }))
  return [...completed, ...running].sort((a, b) => a.startedAt - b.startedAt)
}

export function NetworkActivityIndicator({ activity }: { activity: PluginHttpActivityService }) {
  const { t } = useTranslation()
  const density = useActivitySettings((state) => state.density)
  const showTiming = useActivitySettings((state) => state.showTiming)
  const snapshot = useSyncExternalStore(activity.subscribe, activity.getSnapshot, getServerSnapshot)
  const hasActive = snapshot.active.length > 0
  const needsTick = hasActive && (density !== "compact" || showTiming)
  const [now, setNow] = useState(() =>
    typeof performance === "undefined" ? Date.now() : performance.now()
  )
  const [summaryVisible, setSummaryVisible] = useState(false)
  const wasActive = useRef(false)

  useEffect(() => {
    if (!needsTick) return
    setNow(typeof performance === "undefined" ? Date.now() : performance.now())
    const timer = setInterval(
      () => setNow(typeof performance === "undefined" ? Date.now() : performance.now()),
      TICK_MS
    )
    return () => clearInterval(timer)
  }, [needsTick])

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

  const session = snapshot.session
  const showSummary = !hasActive && summaryVisible && session !== null && session.count > 0

  if (density === "compact") {
    if (!hasActive) return null
    const current = snapshot.active[0]!
    return (
      <span className="pointer-events-none inline-flex min-w-0 items-center gap-1 text-[11px] leading-none text-muted-foreground tabular-nums">
        <span className="max-w-[7rem] truncate">
          {translateLabel(t, current.label, current.category)}
        </span>
        {showTiming && (
          <span className="shrink-0 text-foreground/60">
            {formatDuration(now - current.startedAt)}
          </span>
        )}
        {snapshot.active.length > 1 && (
          <span className="shrink-0">+{snapshot.active.length - 1}</span>
        )}
      </span>
    )
  }

  if (density === "debug") {
    if (!hasActive && !showSummary) return null
    const flow = buildFlow(snapshot, now)
    const flowStart = flow[0]?.startedAt ?? now
    return (
      <div className="pointer-events-none absolute inset-x-0 top-full z-20">
        <div className="pointer-events-auto mx-4 max-h-[50vh] overflow-auto rounded-b-lg border border-t-0 border-border/40 bg-background/95 p-2 font-mono text-[11px] leading-relaxed shadow-lg backdrop-blur md:mx-6">
          <div className="mb-1 flex items-center justify-between gap-3 border-b border-border/30 pb-1 text-muted-foreground">
            <span className="shrink-0 font-medium">{t("networkActivity.debug.title")}</span>
            <span className="truncate tabular-nums">
              {hasActive
                ? t("networkActivity.debug.active", { count: snapshot.active.length })
                : session && session.count > 0
                  ? t("networkActivity.summary", {
                      count: session.count,
                      total: formatDuration(session.totalMs),
                      slowest: translateLabel(
                        t,
                        session.slowestLabel,
                        session.slowestCategory ?? "other"
                      ),
                      duration: formatDuration(session.slowestMs),
                    })
                  : null}
            </span>
          </div>
          <div className="flex flex-col">
            {flow.map((row) => (
              <div
                key={row.id}
                className="flex items-baseline gap-2 border-b border-border/10 py-0.5 last:border-0"
              >
                <span className="w-12 shrink-0 text-right text-muted-foreground/60 tabular-nums">
                  {formatOffset(row.startedAt - flowStart)}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    row.outcome === "error" && "text-destructive"
                  )}
                >
                  {translateLabel(t, row.label, row.category)}
                </span>
                <span className="w-14 shrink-0 text-right text-foreground/70 tabular-nums">
                  {formatDuration(row.durationMs)}
                </span>
                <span
                  className={cn(
                    "w-14 shrink-0 text-right",
                    row.outcome ? STATUS_CLASS[row.outcome] : "text-muted-foreground"
                  )}
                >
                  {row.outcome ? t(STATUS_KEYS[row.outcome]) : t("networkActivity.status.loading")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!hasActive && !showSummary) return null

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
