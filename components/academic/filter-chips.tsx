"use client";

import { cn } from "@/lib/utils";

/**
 * 单选筛选 chips（批次/学期等少量选项的场景）。
 * value 为 string 键；选项少于一屏时横向换行展示。
 */
export function FilterChips({
  items,
  value,
  onChange,
}: {
  items: ReadonlyArray<{ value: string; label: string }>;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm transition-colors",
            item.value === value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground active:bg-muted/60",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
