"use client"

import { useEffect } from "react"
import { useSettingsStore } from "@/lib/stores/settings"
import { useStoredMediaUrl } from "@/lib/storage/media"
import { loadBackgroundImage } from "@/lib/storage/background"

export function BackgroundImage() {
  const backgroundImage = useSettingsStore((s) => s.backgroundImage)
  const backgroundUrl = useStoredMediaUrl(backgroundImage, loadBackgroundImage)
  const overlayOpacity = useSettingsStore((s) => s.backgroundOverlayOpacity)
  const backgroundStyle = useSettingsStore((s) => s.backgroundStyle)
  const backgroundBlurAmount = useSettingsStore((s) => s.backgroundBlurAmount)
  const cardStyle = useSettingsStore((s) => s.cardStyle)
  const cardOpacity = useSettingsStore((s) => s.cardOpacity)

  useEffect(() => {
    document.documentElement.classList.toggle("has-custom-background", !!backgroundUrl)
    return () => document.documentElement.classList.remove("has-custom-background")
  }, [backgroundUrl])

  useEffect(() => {
    if (!backgroundImage || cardStyle === "solid") {
      document.documentElement.style.setProperty("--card-bg-opacity", "1")
    } else if (cardStyle === "translucent") {
      document.documentElement.style.setProperty("--card-bg-opacity", String(cardOpacity / 100))
    } else if (cardStyle === "apple") {
      document.documentElement.style.setProperty(
        "--card-bg-opacity",
        String(Math.min(cardOpacity, 72) / 100)
      )
    } else {
      document.documentElement.style.setProperty("--card-bg-opacity", "0.7")
    }
    return () => {
      document.documentElement.style.setProperty("--card-bg-opacity", "1")
    }
  }, [backgroundImage, cardStyle, cardOpacity])

  if (!backgroundUrl) return null

  const cardStyleCss =
    cardStyle === "translucent"
      ? `.bg-card { background-color: color-mix(in oklch, var(--card) ${cardOpacity}%, transparent) !important; }`
      : cardStyle === "glass"
        ? `.bg-card {
            background-color: color-mix(in oklch, var(--card) ${Math.min(cardOpacity, 85)}%, transparent) !important;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-color: color-mix(in oklch, var(--border) 60%, transparent) !important;
          }`
        : cardStyle === "apple"
          ? `.bg-card {
            background-color: color-mix(in oklch, var(--card) ${Math.min(cardOpacity, 72)}%, transparent) !important;
            backdrop-filter: blur(30px) saturate(180%);
            -webkit-backdrop-filter: blur(30px) saturate(180%);
            border-color: color-mix(in oklch, var(--border) 45%, transparent) !important;
            box-shadow:
              inset 0 1px 0 color-mix(in oklch, var(--foreground) 10%, transparent),
              0 10px 30px oklch(0 0 0 / 8%);
          }`
          : ""

  const blurPx = `${backgroundBlurAmount}px`
  const overlayStyle: React.CSSProperties =
    backgroundStyle === "blur-overlay"
      ? {
          backgroundColor: `color-mix(in oklch, var(--background) ${overlayOpacity}%, transparent)`,
          backdropFilter: `blur(${blurPx})`,
          WebkitBackdropFilter: `blur(${blurPx})`,
        }
      : backgroundStyle === "apple"
        ? {
            backgroundColor: `color-mix(in oklch, var(--background) ${overlayOpacity}%, transparent)`,
            backdropFilter: "blur(36px) saturate(180%) contrast(1.02)",
            WebkitBackdropFilter: "blur(36px) saturate(180%) contrast(1.02)",
          }
        : {
            backgroundColor: `color-mix(in oklch, var(--background) ${overlayOpacity}%, transparent)`,
          }

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: `url(${backgroundUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      >
        <div className="absolute inset-0" style={overlayStyle} />
      </div>
      {cardStyleCss && <style>{cardStyleCss}</style>}
    </>
  )
}
