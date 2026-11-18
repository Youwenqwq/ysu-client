import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { CSSProperties } from "react"

export type CSSCustomProperties = CSSProperties & Record<`--${string}`, string | number | undefined>

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Move focus off background elements before opening a modal/drawer so Radix/Vaul
 * does not apply `aria-hidden` onto an ancestor of a focused element.
 */
export function blurActiveElement() {
  if (typeof document === "undefined") return
  const el = document.activeElement
  if (el instanceof HTMLElement && el !== document.body) el.blur()
}
