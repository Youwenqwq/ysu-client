"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/lib/settings-store";

export function BackgroundImage() {
  const backgroundImage = useSettingsStore((s) => s.backgroundImage);
  const overlayOpacity = useSettingsStore((s) => s.backgroundOverlayOpacity);
  const backgroundStyle = useSettingsStore((s) => s.backgroundStyle);
  const backgroundBlurAmount = useSettingsStore((s) => s.backgroundBlurAmount);
  const cardStyle = useSettingsStore((s) => s.cardStyle);
  const cardOpacity = useSettingsStore((s) => s.cardOpacity);

  useEffect(() => {
    if (!backgroundImage || cardStyle === "solid") {
      document.documentElement.style.setProperty("--card-bg-opacity", "1");
    } else if (cardStyle === "translucent") {
      document.documentElement.style.setProperty("--card-bg-opacity", String(cardOpacity / 100));
    } else {
      document.documentElement.style.setProperty("--card-bg-opacity", "0.7");
    }
    return () => {
      document.documentElement.style.setProperty("--card-bg-opacity", "1");
    };
  }, [backgroundImage, cardStyle, cardOpacity]);

  if (!backgroundImage) return null;

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
        : "";

  const blurPx = `${backgroundBlurAmount}px`;
  const overlayStyle: React.CSSProperties =
    backgroundStyle === "blur-overlay"
      ? {
          backgroundColor: `color-mix(in oklch, var(--background) ${overlayOpacity}%, transparent)`,
          backdropFilter: `blur(${blurPx})`,
          WebkitBackdropFilter: `blur(${blurPx})`,
        }
      : {
          backgroundColor: `color-mix(in oklch, var(--background) ${overlayOpacity}%, transparent)`,
        };

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      >
        <div className="absolute inset-0" style={overlayStyle} />
      </div>
      {cardStyleCss && <style>{cardStyleCss}</style>}
    </>
  );
}
