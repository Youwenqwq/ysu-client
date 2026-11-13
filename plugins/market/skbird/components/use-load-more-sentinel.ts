"use client"

import { useEffect, useRef } from "react"

/**
 * 触底自动加载：监听哨兵元素进入视口即触发 onVisible。
 * enabled 为 false（无更多数据/加载中）时断开监听。
 * 调用方需在 onVisible 内自行做并发去重。
 */
export function useLoadMoreSentinel(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  const cbRef = useRef(onVisible)

  useEffect(() => {
    cbRef.current = onVisible
  }, [onVisible])

  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cbRef.current()
      },
      { rootMargin: "200px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled])

  return ref
}
