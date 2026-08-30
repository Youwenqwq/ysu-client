"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { useTranslation } from "@/lib/i18n/use-translation"
import { SkbirdError, skbirdImageUrl, SKBIRD_ERRNO_TOKEN_INVALID } from "@/lib/extras/skbird/client"
import { getSkbirdClient, useSkbirdStore } from "@/lib/extras/skbird/store"
import type { SkbirdLikeStat, SkbirdUser, SkbirdUserStats } from "@/lib/extras/skbird/types"
import { SkbirdImage } from "@/components/skbird/skbird-image"

export default function SkbirdMePage() {
  const { t } = useTranslation()
  const hasHydrated = useSkbirdStore((s) => s.hasHydrated)
  const token = useSkbirdStore((s) => s.token)

  const [user, setUser] = useState<SkbirdUser | null>(null)
  const [stats, setStats] = useState<SkbirdUserStats | null>(null)
  const [likeStat, setLikeStat] = useState<SkbirdLikeStat | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const client = getSkbirdClient()
    if (!hasHydrated || !client) return
    let cancelled = false
    client
      .userInfo()
      .then((d) => {
        if (!cancelled) setUser(d)
      })
      .catch((e) => {
        if (cancelled) return
        setError(
          e instanceof SkbirdError && e.errno === SKBIRD_ERRNO_TOKEN_INVALID
            ? t("skbird.tokenExpired")
            : t("skbird.loadFailed", {
                message: e instanceof Error ? e.message : String(e),
              })
        )
      })
    // 附属信息失败静默：主信息卡可用即可
    client
      .userStats()
      .then((d) => !cancelled && setStats(d))
      .catch(() => {})
    client
      .likeStat()
      .then((d) => !cancelled && setLikeStat(d))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hasHydrated, token, t])

  if (hasHydrated && !token) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("skbird.noToken")}</EmptyTitle>
          </EmptyHeader>
          <Button asChild>
            <Link href="/dashboard/skbird/settings">{t("skbird.goSettings")}</Link>
          </Button>
        </Empty>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{error}</EmptyTitle>
          </EmptyHeader>
          <Button asChild variant="outline">
            <Link href="/dashboard/skbird/settings">{t("skbird.goSettings")}</Link>
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          {user === null ? (
            <>
              <Skeleton className="size-14 rounded-full" />
              <Skeleton className="h-5 w-32" />
            </>
          ) : (
            <>
              {user.avatarUrl ? (
                <SkbirdImage
                  url={skbirdImageUrl(user.avatarUrl, { w: 100, h: 100 })}
                  alt={user.nickname}
                  className="size-14 rounded-full object-cover"
                />
              ) : null}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-lg font-semibold">{user.nickname}</span>
                <div className="flex flex-wrap items-center gap-1">
                  {user.levelTitle ? (
                    <Badge variant="outline">
                      Lv.{user.level} {user.levelTitle}
                    </Badge>
                  ) : null}
                  <Badge variant={user.certStatus === "no" ? "secondary" : "default"}>
                    {user.certStatus === "no" ? t("skbird.uncertified") : t("skbird.certified")}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("skbird.expLabel")} {user.exp}
                  {user.nextLevelExp > 0 ? ` / ${user.nextLevelExp} (${user.nextLevelTitle})` : ""}
                  {user.regDays > 0
                    ? ` · ${t("skbird.regDaysLabel")} ${user.regDays} ${t("skbird.daysUnit")}`
                    : ""}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {stats || likeStat ? (
        <Card>
          <CardContent className="grid grid-cols-3 gap-2 p-4 text-center">
            <div className="flex flex-col">
              <span className="text-xl font-semibold">{stats?.threadCount ?? "-"}</span>
              <span className="text-xs text-muted-foreground">{t("skbird.statThreads")}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-semibold">{stats?.userCoin ?? "-"}</span>
              <span className="text-xs text-muted-foreground">{t("skbird.statCoin")}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-semibold">{likeStat?.likeNum ?? "-"}</span>
              <span className="text-xs text-muted-foreground">
                {t("skbird.likeStatTitle")}
                {likeStat && likeStat.newLikeNum > 0
                  ? ` (${t("skbird.newLikes", { count: likeStat.newLikeNum })})`
                  : ""}
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
