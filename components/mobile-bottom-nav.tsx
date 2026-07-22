"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  GraduationCap,
  LayoutDashboard,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useSettingsStore } from "@/lib/stores/settings";

export function MobileBottomNav() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const hasBackground = useSettingsStore((s) => !!s.backgroundImage);

  const tabs = [
    { href: "/dashboard", label: t("app.overview"), icon: LayoutDashboard },
    { href: "/dashboard/schedule", label: t("app.schedule"), icon: Calendar },
    { href: "/dashboard/grades", label: t("app.grades"), icon: GraduationCap },
    { href: "/dashboard/me", label: t("app.me"), icon: User },
  ];

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border backdrop-blur pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))] md:hidden",
        hasBackground
          ? "bg-background/60 supports-[backdrop-filter]:bg-background/40"
          : "bg-background/95 supports-[backdrop-filter]:bg-background/80",
      )}
      aria-label="Primary"
    >
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="size-5" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
