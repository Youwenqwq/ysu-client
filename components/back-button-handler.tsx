"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { isCapacitor } from "@/lib/native/platform";

/** Primary routes shown in the bottom navigation bar. */
const PRIMARY_ROUTES = [
  "/dashboard",
  "/dashboard/schedule",
  "/dashboard/grades",
  "/dashboard/services",
  "/dashboard/me",
];

/** Secondary anchor pages with fixed back targets. */
const SECONDARY_BACK_TARGETS: Record<string, string> = {
  "/dashboard/me/settings": "/dashboard/me",
};

function normalizePath(path: string): string {
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

export function BackButtonHandler() {
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!isCapacitor()) return;

    let listenerHandle: { remove: () => Promise<void> } | null = null;

    App.addListener("backButton", () => {
      const currentPath = normalizePath(pathnameRef.current);

      if (currentPath === "/login") {
        App.exitApp();
        return;
      }

      if (PRIMARY_ROUTES.includes(currentPath)) {
        App.exitApp();
        return;
      }

      const secondaryBack = SECONDARY_BACK_TARGETS[currentPath];
      if (secondaryBack) {
        router.replace(secondaryBack);
        return;
      }

      // All other pages simply go back through history.
      router.back();
    }).then((handle) => {
      listenerHandle = handle;
    });

    return () => {
      listenerHandle?.remove();
    };
  }, [router]);

  return null;
}
