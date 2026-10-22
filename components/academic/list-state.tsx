"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { useTranslation } from "@/lib/i18n/use-translation"
import { cn } from "@/lib/utils"
import { CalendarOff, TriangleAlert } from "lucide-react"

/**
 * 查询错误统一 toast（message 为空时回退到通用更新失败文案）。
 *
 * `enabled` 用于抑制重复提示：列表为空时页面已经渲染内联错误态，
 * 再弹一条 toast 是同一个错误说两遍。传 `hasData` 即可——有旧数据可看
 * 时错误不改变页面内容，才需要 toast 提醒刷新失败。
 */
export function useErrorToast(error: { message: string } | undefined, enabled = true) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!error || !enabled) return
    toast.error(error.message || t("app.updating"))
  }, [error, enabled, t])
}

/**
 * 查询失败提示：列表面板里「有错误」和「没数据」必须分开呈现，
 * 否则一次失败会被读成「暂无记录」。error 为 undefined 时渲染空。
 */
export function QueryError({ error, title }: { error?: { message?: string }; title?: string }) {
  const { t } = useTranslation()
  if (!error) return null
  return (
    <ErrorState
      title={title ?? t("app.loadFailedTitle")}
      detail={error.message || undefined}
      icon={<TriangleAlert />}
    />
  )
}

/**
 * 卡片内的紧凑错误行：汇总条之类只有一个横条的容器用不了整块空状态，
 * 但同样不能留一张空白卡片假装没有数据。
 */
export function InlineError({ error, title }: { error?: { message?: string }; title?: string }) {
  const { t } = useTranslation()
  if (!error) return null
  return (
    <div className="flex min-w-0 items-center gap-2 border-l-[3px] border-l-destructive py-1 pl-3">
      <TriangleAlert className="size-4 shrink-0 text-destructive" />
      <span className="shrink-0 text-sm font-medium">{title ?? t("app.loadFailedTitle")}</span>
      {error.message && (
        // 详情截成单行：完整报错由下方列表的错误态承载，这里只作状态提示
        <span
          title={error.message}
          className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-muted-foreground"
        >
          {error.message}
        </span>
      )}
    </div>
  )
}

/** 列表加载骨架（卡片流）。 */
export function LoadingCards({
  count = 3,
  className = "h-24",
}: {
  count?: number
  className?: string
}) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  )
}

/** 列表空状态。 */
export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarOff />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  )
}

/**
 * 查询错误状态：标题位只放短标签，技术细节（上游状态码、原始报错）降到描述位。
 * 代理网关会回整页 HTML 错误页，细节必须能换行且不能撑破标题栏。
 */
export function ErrorState({
  title,
  detail,
  icon,
  children,
}: {
  title: string
  detail?: string
  icon?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {detail && (
          <EmptyDescription className="max-w-full font-mono text-xs break-words">
            {detail}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {children}
    </Empty>
  )
}

/**
 * 重新校验（isValidating）期间旧数据列表的区域级 pending 反馈：
 * 整体降透明度。包在列表容器外，避免弱网下“点了没反应”的错觉。
 */
export function ValidatingList({
  validating,
  className,
  children,
}: {
  validating: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("transition-opacity", validating && "opacity-50", className)}>
      {children}
    </div>
  )
}
