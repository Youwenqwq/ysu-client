"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Bird, Search, Settings, User, Bell, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { SkbirdError, SKBIRD_ERRNO_TOKEN_INVALID } from "@/lib/extras/skbird/client"
import { getSkbirdClient, useSkbirdStore } from "@/lib/extras/skbird/store"
import type { SkbirdCategory, SkbirdThread } from "@/lib/extras/skbird/types"
import { SkbirdThreadCard } from "@/components/skbird/thread-card"
import { useLoadMoreSentinel } from "@/components/skbird/use-load-more-sentinel"

type FeedTab = "hot" | "latest" | "top" | "reward"
/** 时间游标分页的 tab（from_time = 末条 postTime） */
const CURSOR_TABS: Record<string, true> = { latest: true, reward: true }

/** 搜索时间范围（值来自 /thread/v2/searchoptions 的 range_options，文档已固定） */
const SEARCH_RANGES = [
  { value: "all", labelKey: "skbird.rangeAll" },
  { value: "1d", labelKey: "skbird.range1d" },
  { value: "3d", labelKey: "skbird.range3d" },
  { value: "7d", labelKey: "skbird.range7d" },
  { value: "1m", labelKey: "skbird.range1m" },
  { value: "6m", labelKey: "skbird.range6m" },
  { value: "1y", labelKey: "skbird.range1y" },
  { value: "2y", labelKey: "skbird.range2y" },
] as const

export default function SkbirdPage() {
  const { t } = useTranslation()
  const token = useSkbirdStore((s) => s.token)
  const hasHydrated = useSkbirdStore((s) => s.hasHydrated)

  const [tab, setTab] = useState<FeedTab>("hot")
  const [wd, setWd] = useState("")
  const [submittedWd, setSubmittedWd] = useState("")
  const [cateId, setCateId] = useState("latest")
  const [categories, setCategories] = useState<SkbirdCategory[]>([])
  const [threads, setThreads] = useState<SkbirdThread[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [range, setRange] = useState("all")
  const [searchOpen, setSearchOpen] = useState(false)
  const cursorRef = useRef("0")
  const searchPageRef = useRef(1)
  const busyRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // 移动端搜索展开时自动聚焦
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const mapError = useCallback(
    (e: unknown) =>
      e instanceof SkbirdError && e.errno === SKBIRD_ERRNO_TOKEN_INVALID
        ? t("skbird.tokenExpired")
        : t("skbird.loadFailed", {
            message: e instanceof Error ? e.message : String(e),
          }),
    [t]
  )

  const fetchPage = useCallback(
    async (append: boolean): Promise<void> => {
      const client = getSkbirdClient()
      if (!client || busyRef.current) return
      busyRef.current = true
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        let list: SkbirdThread[]
        if (submittedWd) {
          const page = append ? searchPageRef.current + 1 : 1
          list = await client.search(submittedWd, page, range === "all" ? "" : range)
          searchPageRef.current = page
          setHasMore(list.length > 0)
        } else if (tab === "hot") {
          list = await client.hot()
          setHasMore(false)
        } else if (tab === "top") {
          list = await client.toplist()
          setHasMore(false)
        } else {
          const fromTime = append ? cursorRef.current : "0"
          list =
            tab === "reward"
              ? await client.rewardList(fromTime)
              : await client.latest(fromTime, cateId)
          cursorRef.current = list.length > 0 ? String(list[list.length - 1]!.postTime) : "0"
          setHasMore(list.length > 0)
        }
        setThreads((prev) => (append ? [...prev, ...list] : list))
      } catch (e) {
        setError(mapError(e))
      } finally {
        setLoading(false)
        setLoadingMore(false)
        busyRef.current = false
      }
    },
    [tab, cateId, submittedWd, range, mapError]
  )

  // 首屏与条件变化时重新加载
  useEffect(() => {
    if (hasHydrated && token) {
      cursorRef.current = "0"
      searchPageRef.current = 1
      void fetchPage(false)
    }
  }, [hasHydrated, token, fetchPage])

  // 分类列表与未读数：进入页面后各拉一次，失败静默
  useEffect(() => {
    const client = getSkbirdClient()
    if (!hasHydrated || !client) return
    client
      .categories()
      .then(setCategories)
      .catch(() => {})
    client
      .unreadNum()
      .then((u) => setUnread(u.count + u.imCount))
      .catch(() => {})
  }, [hasHydrated, token])

  const canLoadMore = ((CURSOR_TABS[tab] && !submittedWd) || !!submittedWd) && hasMore
  const sentinelRef = useLoadMoreSentinel(
    () => void fetchPage(true),
    canLoadMore && !loading && !error
  )

  // 移动端功能入口注入顶栏右侧（与成绩/日程页同一模式）；桌面端仍走工具栏内按钮
  useMobileHeaderRight(
    <div className="flex items-center gap-0.5">
      <Button
        asChild
        size="icon-sm"
        variant="ghost"
        aria-label={t("skbird.messagesTitle")}
        className="relative"
      >
        <Link href="/dashboard/skbird/messages">
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive" />
          ) : null}
        </Link>
      </Button>
      <Button asChild size="icon-sm" variant="ghost" aria-label={t("skbird.meTitle")}>
        <Link href="/dashboard/skbird/me">
          <User className="size-4" />
        </Link>
      </Button>
      <Button asChild size="icon-sm" variant="ghost" aria-label={t("skbird.settingsTitle")}>
        <Link href="/dashboard/skbird/settings">
          <Settings className="size-4" />
        </Link>
      </Button>
    </div>,
    [unread, t]
  )

  if (hasHydrated && !token) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bird />
            </EmptyMedia>
            <EmptyTitle>{t("skbird.noToken")}</EmptyTitle>
            <EmptyDescription>{t("skbird.noTokenHint")}</EmptyDescription>
          </EmptyHeader>
          <Button asChild>
            <Link href="/dashboard/skbird/settings">{t("skbird.goSettings")}</Link>
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-sm:px-2">
      <div className="flex items-center gap-2">
        {/* tab 栏：移动端搜索展开时让位 */}
        <div
          className={cn(
            "shrink-0 transition-all duration-300",
            searchOpen && "max-sm:w-0 max-sm:overflow-hidden max-sm:opacity-0"
          )}
        >
          <Tabs
            value={submittedWd ? "" : tab}
            onValueChange={(v) => {
              setSubmittedWd("")
              setWd("")
              setTab(v as FeedTab)
            }}
          >
            <TabsList>
              <TabsTrigger value="hot">{t("skbird.tabHot")}</TabsTrigger>
              <TabsTrigger value="latest">{t("skbird.tabLatest")}</TabsTrigger>
              <TabsTrigger value="top">{t("skbird.tabTop")}</TabsTrigger>
              <TabsTrigger value="reward">{t("skbird.tabReward")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* 移动端默认收起为搜索按钮 */}
        {!searchOpen && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="ml-auto sm:hidden"
            aria-label={t("skbird.searchPlaceholder")}
            onClick={() => setSearchOpen(true)}
          >
            <Search className="size-4" />
          </Button>
        )}

        {/* 搜索表单：桌面端常显；移动端展开时动画占据 tab 栏位置 */}
        <form
          className={cn(
            "flex items-center gap-2 transition-all duration-300",
            searchOpen
              ? "max-sm:flex-1"
              : "max-sm:pointer-events-none max-sm:w-0 max-sm:overflow-hidden max-sm:opacity-0 sm:ml-auto"
          )}
          onSubmit={(e) => {
            e.preventDefault()
            setSubmittedWd(wd.trim())
          }}
        >
          {wd || submittedWd ? (
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="w-28 shrink-0" aria-label={t("skbird.rangeAll")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEARCH_RANGES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {t(r.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Input
            ref={searchInputRef}
            value={wd}
            onChange={(e) => setWd(e.target.value)}
            onBlur={(e) => {
              // 失焦恢复 tab 栏；焦点在表单内流转（如点提交/筛选）不算失焦
              if (!wd && !e.currentTarget.form?.contains(e.relatedTarget as Node | null)) {
                setSearchOpen(false)
              }
            }}
            placeholder={t("skbird.searchPlaceholder")}
            className="w-40 max-sm:min-w-0 max-sm:flex-1 sm:w-56"
          />
          <Button
            type="submit"
            size="icon"
            variant="outline"
            aria-label={t("skbird.searchPlaceholder")}
          >
            <Search className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="sm:hidden"
            aria-label={t("skbird.cancelSearch")}
            onClick={() => setSearchOpen(false)}
          >
            <X className="size-4" />
          </Button>
        </form>

        {/* 功能入口：桌面端显示；移动端已注入顶栏 */}
        <div className="flex items-center max-sm:hidden">
          <Button
            asChild
            size="icon"
            variant="ghost"
            aria-label={t("skbird.messagesTitle")}
            className="relative"
          >
            <Link href="/dashboard/skbird/messages">
              <Bell className="size-4" />
              {unread > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive" />
              ) : null}
            </Link>
          </Button>
          <Button asChild size="icon" variant="ghost" aria-label={t("skbird.meTitle")}>
            <Link href="/dashboard/skbird/me">
              <User className="size-4" />
            </Link>
          </Button>
          <Button asChild size="icon" variant="ghost" aria-label={t("skbird.settingsTitle")}>
            <Link href="/dashboard/skbird/settings">
              <Settings className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      {!submittedWd && tab === "latest" && categories.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            {
              cateId: "latest",
              name: t("skbird.allCategories"),
              summary: "",
              iconPath: "",
            },
            ...categories,
          ].map((c) => (
            <Badge
              key={c.cateId}
              variant={cateId === c.cateId ? "default" : "outline"}
              className="shrink-0 cursor-pointer"
              onClick={() => setCateId(c.cateId)}
            >
              {c.name}
            </Badge>
          ))}
        </div>
      ) : null}

      {error ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{error}</EmptyTitle>
          </EmptyHeader>
          <Button asChild variant="outline">
            <Link href="/dashboard/skbird/settings">{t("skbird.goSettings")}</Link>
          </Button>
        </Empty>
      ) : loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : threads.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("skbird.empty")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-3 max-sm:gap-0 max-sm:divide-y max-sm:divide-border">
            {threads.map((thread, i) => (
              <SkbirdThreadCard key={thread.threadId || `t-${i}`} thread={thread} />
            ))}
          </div>
          {(CURSOR_TABS[tab] && !submittedWd) || submittedWd ? (
            <>
              {/* 触底自动加载哨兵 */}
              <div ref={sentinelRef} className="h-1" />
              {loadingMore ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  {t("skbird.loadingMore")}
                </p>
              ) : !hasMore ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  {t("skbird.noMore")}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
