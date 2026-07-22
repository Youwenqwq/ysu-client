import * as React from "react"

// Must match @custom-media --mobile in app/globals.css
const MOBILE_QUERY = "(max-width: 767px)"

/**
 * 是否为移动端视口。
 *
 * 用 useSyncExternalStore 而非 useState+useEffect:后者首渲染恒为 false
 * (桌面),effect 提交后才翻为 true,这个翻转窗口与 SPA 导航的 transition
 * 渲染、数据到达触发的同步重渲染交错时,父子组件可能取到不一致的值,
 * 导致 Dialog/Drawer 根与内容错配(`DialogPortal` must be used within
 * `Dialog`)。useSyncExternalStore 在提交阶段同步纠正,无翻转窗口。
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia(MOBILE_QUERY)
      mql.addEventListener("change", callback)
      return () => mql.removeEventListener("change", callback)
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  )
}
