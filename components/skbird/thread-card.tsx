"use client";

import Link from "next/link";
import { BadgeCheck, Eye, MessageSquare, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/use-translation";
import { skbirdImageUrl } from "@/lib/extras/skbird/client";
import { isCertThread, type SkbirdThread } from "@/lib/extras/skbird/types";
import { SkbirdImage } from "./skbird-image";

export function SkbirdThreadCard({ thread }: { thread: SkbirdThread }) {
  const { t } = useTranslation();
  const cert = isCertThread(thread);
  const hidden = cert && !thread.title && !thread.content;

  return (
    <Link href={`/dashboard/skbird/thread/?id=${thread.threadId}`} className="block">
      <Card className="transition-colors hover:bg-muted/50 max-sm:rounded-none max-sm:bg-transparent max-sm:py-0 max-sm:ring-0">
        <CardContent className="flex flex-col gap-2 p-4 max-sm:px-0 max-sm:py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {thread.avatarUrl ? (
              <SkbirdImage
                url={skbirdImageUrl(thread.avatarUrl, { w: 64, h: 64 })}
                alt={thread.nickname}
                className="size-5 shrink-0 rounded-full object-cover"
              />
            ) : null}
            <span className="truncate">{thread.nickname}</span>
            {thread.userLevelTitle ? <Badge variant="outline">{thread.userLevelTitle}</Badge> : null}
            <span className="ml-auto shrink-0">{thread.postTimeText}</span>
          </div>

          {hidden ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BadgeCheck className="size-4 shrink-0" />
              {t("skbird.certHidden")}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="font-medium leading-snug">{thread.title}</span>
                {cert ? <Badge variant="secondary">{t("skbird.certBadge")}</Badge> : null}
              </div>
              {thread.content ? (
                <p className="line-clamp-2 text-sm text-muted-foreground">{thread.content}</p>
              ) : null}
            </>
          )}

          {thread.imgPaths.length > 0 ? (
            <div className="flex gap-2">
              {thread.imgPaths.slice(0, 3).map((p) => (
                <SkbirdImage
                  key={p}
                  url={skbirdImageUrl(p, { w: 200, h: 200 })}
                  alt=""
                  className="size-20 rounded-md object-cover"
                />
              ))}
              {thread.imgPaths.length > 3 ? (
                <div className="flex size-20 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                  +{thread.imgPaths.length - 3}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {thread.cateName ? <span>{thread.cateName}</span> : null}
            <span className="inline-flex items-center gap-1">
              <ThumbsUp className="size-3" />
              {thread.likeCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" />
              {thread.commentCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3" />
              {thread.viewCount}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
