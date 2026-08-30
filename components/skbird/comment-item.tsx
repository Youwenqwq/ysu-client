"use client"

import { useState } from "react"
import { ThumbsUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "@/lib/i18n/use-translation"
import { skbirdImageUrl } from "@/lib/extras/skbird/client"
import { getSkbirdClient } from "@/lib/extras/skbird/store"
import type { SkbirdComment } from "@/lib/extras/skbird/types"
import { SkbirdImage } from "./skbird-image"

export function SkbirdCommentItem({
  comment,
  threadId,
  depth = 0,
}: {
  comment: SkbirdComment
  threadId: string
  depth?: number
}) {
  const { t } = useTranslation()
  const [likeHas, setLikeHas] = useState(comment.likeHas)
  const [likeCount, setLikeCount] = useState(comment.likeCount)
  const [pending, setPending] = useState(false)

  async function handleLike() {
    const client = getSkbirdClient()
    if (!client || pending) return
    setPending(true)
    const next = !likeHas
    try {
      await client.like(threadId, next ? 1 : 0, comment.commentId)
      setLikeHas(next)
      setLikeCount((c) => c + (next ? 1 : -1))
    } catch {
      // 失败静默：状态不翻转
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={depth > 0 ? "ml-6 border-l pl-3" : undefined}>
      <div className="flex gap-2.5">
        {comment.avatarUrl ? (
          <SkbirdImage
            url={skbirdImageUrl(comment.avatarUrl, { w: 64, h: 64 })}
            alt={comment.nickname}
            className="mt-0.5 size-7 shrink-0 rounded-full object-cover"
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{comment.nickname}</span>
            {comment.isAuthor ? <Badge variant="secondary">{t("skbird.authorBadge")}</Badge> : null}
            {comment.userLevelTitle ? (
              <Badge variant="outline">{comment.userLevelTitle}</Badge>
            ) : null}
            <span className="ml-auto shrink-0">{comment.postTimeText}</span>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{comment.content}</p>
          <button
            type="button"
            onClick={handleLike}
            disabled={pending}
            className={`inline-flex w-fit items-center gap-1 py-0.5 text-xs ${
              likeHas ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <ThumbsUp className="size-3" />
            {likeCount}
            {comment.authorLiked ? (
              <Badge variant="outline" className="ml-1">
                {t("skbird.authorLiked")}
              </Badge>
            ) : null}
          </button>
        </div>
      </div>
      {comment.replies.length > 0 ? (
        <div className="mt-3 flex flex-col gap-3">
          {comment.replies.map((r) => (
            <SkbirdCommentItem
              key={r.commentId}
              comment={r}
              threadId={threadId}
              depth={depth + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
