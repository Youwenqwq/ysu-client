import { defineStore } from "@orahako/sdk"

export type CardStyle = "solid" | "translucent" | "glass"
export type BackgroundStyle = "overlay" | "blur-overlay"
export type ColorMode = "light" | "dark" | "system"

export const DEFAULT_SIDEBAR_WIDTH = 288
export const MIN_SIDEBAR_WIDTH = 208
export const MAX_SIDEBAR_WIDTH = 384

export interface AppearanceStoreState {
  readonly colorMode: ColorMode
  readonly backgroundImage: string
  readonly backgroundStyle: BackgroundStyle
  readonly backgroundOverlayOpacity: number
  readonly backgroundBlurAmount: number
  readonly cardStyle: CardStyle
  readonly cardOpacity: number
  readonly sidebarWidth: number
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

export function computeCardBgOpacity(
  hasBackground: boolean,
  cardStyle: CardStyle,
  cardOpacity: number
): string {
  if (!hasBackground || cardStyle === "solid") {
    return "1"
  }
  if (cardStyle === "translucent") {
    return String(cardOpacity / 100)
  }
  return "0.7"
}

export function buildCardStyleCss(cardStyle: CardStyle, cardOpacity: number): string {
  if (cardStyle === "translucent") {
    return `.bg-card { background-color: color-mix(in oklch, var(--card) ${cardOpacity}%, transparent) !important; }`
  }
  if (cardStyle === "glass") {
    return `.bg-card {
      background-color: color-mix(in oklch, var(--card) ${Math.min(cardOpacity, 85)}%, transparent) !important;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-color: color-mix(in oklch, var(--border) 60%, transparent) !important;
    }`
  }
  return ""
}

export const appearanceStore = defineStore({
  init: (): AppearanceStoreState => ({
    colorMode: "system",
    backgroundImage: "",
    backgroundStyle: "overlay",
    backgroundOverlayOpacity: 75,
    backgroundBlurAmount: 20,
    cardStyle: "solid",
    cardOpacity: 100,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  }),
  persist: {
    key: "appearance",
    mode: "local",
    version: 1,
  },
  actions: {
    setColorMode(ctx, colorMode: ColorMode) {
      ctx.set((prev) => ({ ...prev, colorMode }))
    },
    setBackgroundImage(ctx, backgroundImage: string) {
      ctx.set((prev) => ({ ...prev, backgroundImage }))
    },
    setBackgroundStyle(ctx, backgroundStyle: BackgroundStyle) {
      ctx.set((prev) => ({ ...prev, backgroundStyle }))
    },
    setBackgroundOverlayOpacity(ctx, opacity: number) {
      const clamped = Math.min(100, Math.max(0, Math.round(opacity)))
      ctx.set((prev) => ({ ...prev, backgroundOverlayOpacity: clamped }))
    },
    setBackgroundBlurAmount(ctx, amount: number) {
      const clamped = Math.min(50, Math.max(1, Math.round(amount)))
      ctx.set((prev) => ({ ...prev, backgroundBlurAmount: clamped }))
    },
    setCardStyle(ctx, cardStyle: CardStyle) {
      ctx.set((prev) => ({ ...prev, cardStyle }))
    },
    setCardOpacity(ctx, opacity: number) {
      const clamped = Math.min(100, Math.max(50, Math.round(opacity)))
      ctx.set((prev) => ({ ...prev, cardOpacity: clamped }))
    },
    setSidebarWidth(ctx, width: number) {
      ctx.set((prev) => ({ ...prev, sidebarWidth: clampSidebarWidth(width) }))
    },
    resetBackground(ctx) {
      ctx.set((prev) => ({
        ...prev,
        backgroundImage: "",
        backgroundStyle: "overlay",
        backgroundOverlayOpacity: 75,
        backgroundBlurAmount: 20,
        cardStyle: "solid",
        cardOpacity: 100,
      }))
    },
  },
})

export type AppearanceStoreDefinition = typeof appearanceStore
export type AppearanceStoreInstance = ReturnType<typeof appearanceStore.create>
