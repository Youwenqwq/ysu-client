import { Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type {
  DerivedComponentProps,
  NetworkActivityCategory,
  NetworkActivityOutcome,
  NetworkActivitySnapshot,
  ObservableSource,
  PluginLocale,
  SlotComponent,
  TranslationKeyOf,
  Translator,
} from "@orahako/sdk"
import { cn } from "@orahako/ui-primitives"
import type { NetworkActivityDictionary } from "./dictionary"
import type { ActivitySettingsStore } from "./state"

const SUMMARY_VISIBLE_MS = 4_000
const COMPACT_DONE_MS = 950
const TICK_MS = 100
const MAX_VISIBLE_REQUESTS = 3

const COMPACT_DONE_STYLE = `
@keyframes orahako-net-done-lifecycle {
  0% {
    opacity: 0;
    transform: scale(0.8);
  }
  18% {
    opacity: 1;
    transform: scale(1);
  }
  74% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(0.92);
  }
}
@keyframes orahako-net-done-check {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}
[data-network-compact-done] {
  animation: orahako-net-done-lifecycle ${COMPACT_DONE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
[data-network-compact-done-check] {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: orahako-net-done-check 260ms cubic-bezier(0.22, 1, 0.36, 1) 60ms forwards;
}
@media (prefers-reduced-motion: reduce) {
  [data-network-compact-done],
  [data-network-compact-done-check] {
    animation: none;
    stroke-dashoffset: 0;
    opacity: 1;
  }
}
`.trim()

type CategoryTranslationKey = Extract<
  TranslationKeyOf<NetworkActivityDictionary>,
  `category.${string}`
>

const CATEGORY_KEYS: Readonly<Record<string, CategoryTranslationKey>> = {
  auth: "category.auth",
  academic: "category.academic",
  mobile: "category.mobile",
  "one-stop": "category.oneStop",
  campus: "category.campus",
  payment: "category.payment",
  wechat: "category.wechat",
  other: "category.other",
}

const STATUS_KEYS: Readonly<
  Record<
    NetworkActivityOutcome,
    Extract<TranslationKeyOf<NetworkActivityDictionary>, `status.${string}`>
  >
> = {
  ok: "status.ok",
  error: "status.error",
  aborted: "status.aborted",
}

const STATUS_CLASS: Readonly<Record<NetworkActivityOutcome, string>> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
  aborted: "text-amber-600 dark:text-amber-400",
}

export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms)
  if (clamped < 1_000) return `${Math.max(1, Math.round(clamped))}ms`
  if (clamped < 10_000) return `${(clamped / 1_000).toFixed(1)}s`
  return `${Math.round(clamped / 1_000)}s`
}

function formatOffset(ms: number): string {
  return `+${(Math.max(0, ms) / 1_000).toFixed(1)}s`
}

function resolveActivityLabel(
  t: Translator<NetworkActivityDictionary>,
  translateExternal: (key: string, locale: PluginLocale) => string,
  locale: PluginLocale,
  label: string | undefined,
  category: NetworkActivityCategory
): string {
  if (label) {
    const external = translateExternal(label, locale)
    if (external !== label) return external
  }
  const categoryKey = CATEGORY_KEYS[category] ?? "category.other"
  return t(categoryKey)
}

interface FlowRow {
  readonly id: number
  readonly category: NetworkActivityCategory
  readonly label?: string
  readonly startedAt: number
  readonly durationMs: number
  readonly outcome?: NetworkActivityOutcome
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

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now()
}

export interface NetworkActivityStripInject {
  readonly translateExternal: (key: string, locale: PluginLocale) => string
  readonly hooks: {
    readonly activity: ObservableSource<NetworkActivitySnapshot>
  }
}

export type NetworkActivityStripProps = DerivedComponentProps<
  Record<string, never>,
  NetworkActivityDictionary,
  undefined,
  ActivitySettingsStore,
  NetworkActivityStripInject
>

export const NetworkActivityStrip: SlotComponent<NetworkActivityStripProps> = (props) => {
  const { t, locale, translateExternal, useStore, useActivity } = props
  const density = useStore((state) => state.density)
  const showTiming = useStore((state) => state.showTiming)
  const showCompletionCheck = useStore((state) => state.showCompletionCheck)
  const snapshot = useActivity()
  const hasActive = snapshot.active.length > 0
  const needsTick = hasActive && (density !== "compact" || showTiming)
  const [now, setNow] = useState(monotonicNow)
  const [summaryVisible, setSummaryVisible] = useState(false)
  const [compactDoneVisible, setCompactDoneVisible] = useState(false)
  const [compactDoneKey, setCompactDoneKey] = useState(0)
  const wasActive = useRef(false)
  const session = snapshot.session
  const lastOutcome = snapshot.history[snapshot.history.length - 1]?.outcome
  const compactCompletedOk = lastOutcome === "ok"

  useEffect(() => {
    if (!needsTick) return
    setNow(monotonicNow())
    const timer = setInterval(() => setNow(monotonicNow()), TICK_MS)
    return () => clearInterval(timer)
  }, [needsTick])

  useEffect(() => {
    if (hasActive) {
      wasActive.current = true
      setSummaryVisible(false)
      setCompactDoneVisible(false)
      return
    }
    if (!wasActive.current) return
    wasActive.current = false
    setSummaryVisible(true)
    const summaryTimer = setTimeout(() => setSummaryVisible(false), SUMMARY_VISIBLE_MS)

    let compactTimer: ReturnType<typeof setTimeout> | undefined
    if (density === "compact" && showCompletionCheck && compactCompletedOk) {
      setCompactDoneKey((k) => k + 1)
      setCompactDoneVisible(true)
      compactTimer = setTimeout(() => setCompactDoneVisible(false), COMPACT_DONE_MS)
    }

    return () => {
      clearTimeout(summaryTimer)
      if (compactTimer !== undefined) clearTimeout(compactTimer)
    }
  }, [hasActive, density, showCompletionCheck, compactCompletedOk])

  const showSummary = !hasActive && summaryVisible && session !== null && session.count > 0

  if (density === "compact") {
    if (!hasActive) {
      if (!compactDoneVisible || !showCompletionCheck) return null
      return (
        <span
          key={compactDoneKey}
          data-network-compact-done=""
          aria-hidden="true"
          className="pointer-events-none inline-flex shrink-0 items-center text-foreground/80"
        >
          <style data-network-compact-done-style="">{COMPACT_DONE_STYLE}</style>
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
            <circle
              cx="8"
              cy="8"
              r="6.25"
              stroke="currentColor"
              strokeOpacity="0.28"
              strokeWidth="1.2"
            />
            <path
              d="M4.8 8.2 L7 10.4 L11.4 5.8"
              pathLength={100}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              data-network-compact-done-check=""
            />
          </svg>
        </span>
      )
    }
    const current = snapshot.active[0]!
    return (
      <span className="pointer-events-none inline-flex min-w-0 items-center gap-1 text-[11px] leading-none text-muted-foreground tabular-nums">
        <span className="max-w-[7rem] truncate">
          {resolveActivityLabel(t, translateExternal, locale, current.label, current.category)}
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
            <span className="shrink-0 font-medium">{t("debug.title")}</span>
            <span className="truncate tabular-nums">
              {hasActive
                ? t("debug.active", { count: snapshot.active.length })
                : session && session.count > 0
                  ? t("summary", {
                      count: session.count,
                      total: formatDuration(session.totalMs),
                      slowest: resolveActivityLabel(
                        t,
                        translateExternal,
                        locale,
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
                  {resolveActivityLabel(t, translateExternal, locale, row.label, row.category)}
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
                  {row.outcome ? t(STATUS_KEYS[row.outcome]) : t("status.loading")}
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
            <span className="shrink-0 font-medium">{t("live")}</span>
            <span className="flex min-w-0 items-center gap-2 overflow-hidden">
              {visible.map((entry) => (
                <span
                  key={entry.id}
                  className="inline-flex shrink-0 items-center gap-1 tabular-nums"
                >
                  <span className="truncate">
                    {resolveActivityLabel(
                      t,
                      translateExternal,
                      locale,
                      entry.label,
                      entry.category
                    )}
                  </span>
                  <span className="text-foreground/60">
                    {formatDuration(now - entry.startedAt)}
                  </span>
                </span>
              ))}
              {hidden > 0 && <span className="shrink-0 tabular-nums">+{hidden}</span>}
            </span>
          </>
        ) : showSummary && session ? (
          <span className="truncate tabular-nums">
            {t("summary", {
              count: session.count,
              total: formatDuration(session.totalMs),
              slowest: resolveActivityLabel(
                t,
                translateExternal,
                locale,
                session.slowestLabel,
                session.slowestCategory ?? "other"
              ),
              duration: formatDuration(session.slowestMs),
            })}
            {session.failed > 0 && t("failed", { count: session.failed })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
