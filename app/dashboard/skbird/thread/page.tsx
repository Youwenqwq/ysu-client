"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, Bookmark, MessageSquare, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  SkbirdError,
  skbirdImageUrl,
  SKBIRD_ERRNO_TOKEN_INVALID,
} from "@/lib/extras/skbird/client";
import { getSkbirdClient } from "@/lib/extras/skbird/store";
import { isCertThread, type SkbirdComment, type SkbirdThread } from "@/lib/extras/skbird/types";
import { SkbirdImage } from "@/components/skbird/skbird-image";
import { SkbirdCommentItem } from "@/components/skbird/comment-item";

function ThreadDetail() {
  const { t } = useTranslation();
  const id = useSearchParams().get("id");

  const [thread, setThread] = useState<SkbirdThread | null>(null);
  /** 解锁后从马住列表读出的全文（仅认证帖） */
  const [unlocked, setUnlocked] = useState<SkbirdThread | null>(null);
  const [comments, setComments] = useState<SkbirdComment[] | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likePending, setLikePending] = useState(false);
  const [markPending, setMarkPending] = useState(false);

  useEffect(() => {
    const client = getSkbirdClient();
    if (!id) return;
    if (!client) {
      setError(t("skbird.noToken"));
      return;
    }
    let cancelled = false;
    client
      .thread(id)
      .then((d) => {
        if (cancelled) return;
        setThread(d.thread);
        // 评论签名随详情签发；认证帖评论同样可读。
        // 评论失败不拖垮详情：降级为无评论。
        client
          .comments(id, d.commentSign)
          .then((list) => {
            if (!cancelled) setComments(list);
          })
          .catch(() => {
            if (!cancelled) setComments([]);
          });
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof SkbirdError && e.errno === SKBIRD_ERRNO_TOKEN_INVALID
            ? t("skbird.tokenExpired")
            : t("skbird.loadFailed", { message: e instanceof Error ? e.message : String(e) }),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const handleUnlock = useCallback(async () => {
    const client = getSkbirdClient();
    if (!client || !id) return;
    setUnlocking(true);
    try {
      const full = await client.unlockThread(id);
      if (full && (full.title || full.content)) {
        setUnlocked(full);
      } else {
        setError(t("skbird.unlockFailed"));
      }
    } catch {
      setError(t("skbird.unlockFailed"));
    } finally {
      setUnlocking(false);
    }
  }, [id, t]);

  const handleLike = useCallback(async () => {
    const client = getSkbirdClient();
    if (!client || !thread || likePending) return;
    setLikePending(true);
    const next = !thread.likeHas;
    try {
      await client.like(thread.threadId, next ? 1 : 0);
      setThread({
        ...thread,
        likeHas: next,
        likeCount: thread.likeCount + (next ? 1 : -1),
      });
    } catch {
      // 点赞失败静默：状态不翻转
    } finally {
      setLikePending(false);
    }
  }, [thread, likePending]);

  const handleMark = useCallback(async () => {
    const client = getSkbirdClient();
    if (!client || !thread || markPending) return;
    setMarkPending(true);
    const next = !thread.markHas;
    try {
      await client.mark(thread.threadId, next ? 1 : 2);
      setThread({
        ...thread,
        markHas: next,
        markCount: thread.markCount + (next ? 1 : -1),
      });
    } catch {
      // 马住失败静默：状态不翻转
    } finally {
      setMarkPending(false);
    }
  }, [thread, markPending]);

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
    );
  }

  if (!thread) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const cert = isCertThread(thread);
  const hidden = cert && !thread.title && !thread.content && !unlocked;
  const display = unlocked ?? thread;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {thread.avatarUrl ? (
              <SkbirdImage
                url={skbirdImageUrl(thread.avatarUrl, { w: 64, h: 64 })}
                alt={thread.nickname}
                className="size-6 shrink-0 rounded-full object-cover"
              />
            ) : null}
            <span className="truncate">{thread.nickname}</span>
            {thread.userLevelTitle ? <Badge variant="outline">{thread.userLevelTitle}</Badge> : null}
            <span className="ml-auto shrink-0 text-xs">{thread.postTimeText}</span>
          </div>

          {hidden ? (
            <div className="flex flex-col items-start gap-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <BadgeCheck className="size-4 shrink-0" />
                {t("skbird.certHidden")}
              </div>
              <Button onClick={handleUnlock} disabled={unlocking}>
                {unlocking ? t("skbird.unlocking") : t("skbird.unlock")}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold leading-snug">{display.title}</h1>
                {cert ? <Badge variant="secondary">{t("skbird.certBadge")}</Badge> : null}
              </div>
              {unlocked ? (
                <p className="text-xs text-muted-foreground">{t("skbird.unlockedFromMark")}</p>
              ) : null}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{display.content}</p>
            </>
          )}

          {display.imgPaths.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {display.imgPaths.map((p) => (
                <SkbirdImage
                  key={p}
                  url={skbirdImageUrl(p, { w: 200, h: 200 })}
                  zoomUrl={skbirdImageUrl(p, "original")}
                  alt=""
                  className="size-25 rounded-md object-cover"
                  zoomable
                />
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {thread.cateName ? <span>{thread.cateName}</span> : null}
            <button
              type="button"
              onClick={handleLike}
              disabled={likePending}
              className={`inline-flex items-center gap-1 ${thread.likeHas ? "text-primary" : ""}`}
            >
              <ThumbsUp className="size-4" />
              {thread.likeCount}
            </button>
            <button
              type="button"
              onClick={handleMark}
              disabled={markPending}
              className={`inline-flex items-center gap-1 ${thread.markHas ? "text-primary" : ""}`}
            >
              <Bookmark className="size-4" />
              {thread.markHas ? t("skbird.marked") : t("skbird.mark")}
            </button>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-4" />
              {thread.commentCount}
            </span>
          </div>
        </CardContent>
      </Card>

      <Separator />
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("skbird.commentsTitle")}
          {thread.commentCount > 0 ? ` (${thread.commentCount})` : ""}
        </h2>
        {comments === null ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : comments.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("skbird.noComments")}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {comments.map((c) => (
              <SkbirdCommentItem key={c.commentId} comment={c} threadId={thread.threadId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SkbirdThreadPage() {
  // 静态导出下 useSearchParams 必须包 Suspense
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <ThreadDetail />
    </Suspense>
  );
}
