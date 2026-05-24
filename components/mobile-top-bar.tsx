"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useMobileHeaderStore } from "@/lib/mobile-header-store";
import { useSettingsStore } from "@/lib/settings-store";
import { RefreshIndicator } from "@/components/refresh-indicator";
import { StaleIndicator } from "@/components/stale-indicator";
import { cn } from "@/lib/utils";
import { IS_DEMO } from "@/lib/demo-data";

interface Props {
  title: string;
  showBack?: boolean;
}

export function MobileTopBar({ title, showBack }: Props) {
  const router = useRouter();
  const rightSlot = useMobileHeaderStore((s) => s.rightSlot);
  const hasBackground = useSettingsStore((s) => !!s.backgroundImage);

  return (
    <header
      className={cn(
        "fixed top-0 z-30 flex h-[calc(3rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] w-full items-center justify-between gap-3 px-4 pt-[var(--safe-area-inset-top,env(safe-area-inset-top,0px))] backdrop-blur md:hidden",
        hasBackground
          ? "bg-background/60 supports-[backdrop-filter]:bg-background/40"
          : "bg-background/95 supports-[backdrop-filter]:bg-background/80",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showBack && (
          <button
            type="button"
            onClick={() => router.back()}
            className="shrink-0 -ml-1 flex size-8 items-center justify-center rounded-full text-foreground transition-colors active:bg-muted"
            aria-label="Back"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <h1 className="truncate text-base font-semibold">{title}</h1>
        {IS_DEMO && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            演示
          </span>
        )}
        <RefreshIndicator />
        <StaleIndicator />
      </div>
      <div className="flex items-center gap-1">{rightSlot}</div>
    </header>
  );
}
