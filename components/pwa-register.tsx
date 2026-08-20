"use client";

import { useEffect } from "react";

import { isCapacitor } from "@/lib/native/platform";
import { APP_BUILD, APP_VERSION } from "@/lib/version";

export function PwaRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      isCapacitor()
    ) {
      return;
    }

    const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || "";
    navigator.serviceWorker
      .register(`${basePath}/sw.js?v=${APP_VERSION}-${APP_BUILD}`, {
        updateViaCache: "none",
      })
      .catch(() => {});
  }, []);

  return null;
}
