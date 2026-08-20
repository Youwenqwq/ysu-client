"use client";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";

/**
 * 移动端筛选入口三件套：FilterTrigger 放在页面 header 右侧（useMobileHeaderRight），
 * 点击打开 FilterDrawer；抽屉内的单选场景用 FilterOptionList。
 * 桌面端不走这里——按既有风格在页面内 inline 展示控件。
 */

/** header 右侧的筛选触发按钮：当前值摘要 + 下拉箭头。 */
export function FilterTrigger({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        // 抽屉打开前先移走焦点，避免 Chrome aria-hidden/focus 警告
        e.currentTarget.blur();
        onClick();
      }}
      className="h-8 max-w-44 gap-0.5 px-2 text-sm"
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="size-3.5 shrink-0" />
    </Button>
  );
}

/** 统一筛选抽屉外壳。 */
export function FilterDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          {/* vaul/radix 要求可访问描述；无显式描述时回退为 sr-only 标题 */}
          <DrawerDescription className={description ? undefined : "sr-only"}>
            {description ?? title}
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-6">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}

/** 抽屉内纵向单选列表（批次/学期等可枚举的筛选维度），选项多时可滚动。 */
export function FilterOptionList({
  items,
  value,
  onChange,
}: {
  items: ReadonlyArray<{ value: string; label: string }>;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              "flex items-center gap-3 py-3 text-left text-sm transition-colors active:bg-muted/60",
              active && "font-medium text-primary",
            )}
          >
            <span className="flex-1">{item.label}</span>
            {active && <Check className="size-4 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
