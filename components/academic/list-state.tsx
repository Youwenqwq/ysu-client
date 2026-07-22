"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import { CalendarOff } from "lucide-react";

/** 查询错误统一 toast（message 为空时回退到通用更新失败文案）。 */
export function useErrorToast(error: { message: string } | undefined) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!error) return;
    toast.error(error.message || t("app.updating"));
  }, [error, t]);
}

/** 列表加载骨架（卡片流）。 */
export function LoadingCards({ count = 3, className = "h-24" }: { count?: number; className?: string }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  );
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
  );
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
  validating: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("transition-opacity", validating && "opacity-50", className)}>
      {children}
    </div>
  );
}
