import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 打开 Dialog/Drawer 前调用：把焦点从将被 aria-hidden 的背景内容上移走，
 * 避免 Chrome 报 "Blocked aria-hidden on an element because its descendant
 * retained focus"（radix-ui/vaul 在 FocusScope 接管焦点前就施加了 aria-hidden）。
 */
export function blurActiveElement() {
  if (typeof document === "undefined") return
  const el = document.activeElement
  if (el instanceof HTMLElement && el !== document.body) el.blur()
}
