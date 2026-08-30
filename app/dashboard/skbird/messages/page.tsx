"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { useTranslation } from "@/lib/i18n/use-translation"
import { SkbirdError, skbirdImageUrl, SKBIRD_ERRNO_TOKEN_INVALID } from "@/lib/extras/skbird/client"
import { getSkbirdClient, useSkbirdStore } from "@/lib/extras/skbird/store"
import type { SkbirdMessage, SkbirdUnread } from "@/lib/extras/skbird/types"
import { SkbirdImage } from "@/components/skbird/skbird-image"
import { useLoadMoreSentinel } from "@/components/skbird/use-load-more-sentinel"

export default function SkbirdMessagesPage() {
  const { t } = useTranslation()
  const hasHydrated = useSkbirdStore((s) => s.hasHydrated)
  const token = useSkbirdStore((s) => s.token)

  const [messages, setMessages] = useState<SkbirdMessage[]>([])
  const [unread, setUnread] = useState<SkbirdUnread | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cursorRef = useRef("0")
  const busyRef = useRef(false)

  const load = useCallback(
    async (append: boolean) => {
      const client = getSkbirdClient()
      if (!client || busyRef.current) return
      busyRef.current = true
      if (append) setLoadingMore(true)
      else setLoading(true)
      try {
        const fromTime = append ? cursorRef.current : "0"
        const list = await client.messages(fromTime)
        cursorRef.current = list.length > 0 ? String(list[list.length - 1]!.time) : "0"
        setHasMore(list.length > 0)
        setMessages((prev) => (append ? [...prev, ...list] : list))
      } catch (e) {
        setError(
          e instanceof SkbirdError && e.errno === SKBIRD_ERRNO_TOKEN_INVALID
            ? t("skbird.tokenExpired")
            : t("skbird.loadFailed", {
                message: e instanceof Error ? e.message : String(e),
              })
        )
      } finally {
        setLoading(false)
        setLoadingMore(false)
        busyRef.current = false
      }
    },
    [t]
  )

  const sentinelRef = useLoadMoreSentinel(() => void load(true), hasMore && !loading && !error)

  useEffect(() => {
    const client = getSkbirdClient()
    if (!hasHydrated || !client) return
    void load(false)
    client
      .unreadNum()
      .then(setUnread)
      .catch(() => {})
  }, [hasHydrated, token, load])

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

  return (
    <div className="flex flex-col gap-4 p-4">
      {unread ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Card>
            <CardContent className="p-3">
              <div className="text-lg font-semibold">{unread.count}</div>
              <div className="text-xs text-muted-foreground">{t("skbird.unreadSection")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-lg font-semibold">{unread.imCount}</div>
              <div className="text-xs text-muted-foreground">{t("skbird.imCountLabel")}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-lg font-semibold">{unread.markCount}</div>
              <div className="text-xs text-muted-foreground">{t("skbird.markUpdatesLabel")}</div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {error ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{error}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("skbird.messagesEmpty")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {messages.map((m, i) => (
              <Card key={m.id || i}>
                <CardContent className="flex gap-3 p-3">
                  {m.avatarUrl ? (
                    <SkbirdImage
                      url={skbirdImageUrl(m.avatarUrl, { w: 64, h: 64 })}
                      alt={m.nickname}
                      className="size-9 shrink-0 rounded-full object-cover"
                    />
                  ) : null}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {m.nickname ? <span className="truncate">{m.nickname}</span> : null}
                      <span className="ml-auto shrink-0">{m.timeText}</span>
                    </div>
                    {m.title ? <div className="text-sm font-medium">{m.title}</div> : null}
                    {m.content ? (
                      <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                        {m.content}
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div ref={sentinelRef} className="h-1" />
          {loadingMore ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              {t("skbird.loadingMore")}
            </p>
          ) : !hasMore ? (
            <p className="py-2 text-center text-xs text-muted-foreground">{t("skbird.noMore")}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
