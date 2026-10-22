"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { toast } from "sonner"
import { fetchStateless, headerSingle } from "@/lib/cookie"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useBackLayer } from "@/hooks/use-back-handler"
import { isCapacitor } from "@/lib/native/platform"
import { YsuFile } from "@/lib/native/ysu-file"

/** 关闭动画时长，与过渡类 duration 匹配 */
const LIGHTBOX_TRANSITION_MS = 200

const MIN_SCALE = 1
const MAX_SCALE = 5
/** 点击/双击放大到的倍率 */
const ZOOM_STEP = 2.5
const DOUBLE_TAP_MS = 300
/** 位移小于该值视为点按而非拖拽 */
const TAP_SLOP_PX = 8

/** 长按触发保存的延迟 */
const LONG_PRESS_MS = 500

/** Blob → 纯 base64（无 data: 前缀），分块拼接避免爆栈 */
function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ""
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
  })
}

/** 从 MIME 类型推导文件扩展名 */
function extForMime(mime: string): string {
  const sub = mime.split("/")[1]?.toLowerCase() ?? ""
  if (!sub || sub === "jpeg") return "jpg"
  if (sub === "svg+xml") return "svg"
  return sub
}

function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [entered, setEntered] = useState(false)
  const [closing, setClosing] = useState(false)
  const [zoomedIn, setZoomedIn] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  /** 当前变换。手势期间直写 DOM，不进 React state */
  const tfRef = useRef({ scale: 1, x: 0, y: 0 })
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const gestureRef = useRef({
    downX: 0,
    downY: 0,
    moved: false,
    lastX: 0,
    lastY: 0,
    pinchDist: 0,
    pinchScale: 1,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
  })
  /** 长按保存计时器句柄（仅原生端触屏） */
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saveSheetOpen, setSaveSheetOpen] = useState(false)
  const native = isCapacitor()

  // 挂载后下一帧进入，触发开启过渡
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // 卸载时清理长按计时器
  useEffect(() => {
    return () => clearTimeout(longPressTimerRef.current)
  }, [])

  // 打开期间锁定背景滚动 + Esc 关闭
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") beginClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function beginClose() {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, LIGHTBOX_TRANSITION_MS)
  }

  useBackLayer(beginClose)

  function applyTransform(animate: boolean) {
    const el = wrapRef.current
    if (!el) return
    el.style.transition = animate ? "transform 200ms ease-out" : "none"
    const { scale, x, y } = tfRef.current
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    setZoomedIn(scale > MIN_SCALE)
  }

  /** 拖拽边界：图片不拖出视口 */
  function clampPan() {
    const el = wrapRef.current
    if (!el) return
    const tf = tfRef.current
    const maxX = Math.max(0, (el.offsetWidth * tf.scale - window.innerWidth) / 2)
    const maxY = Math.max(0, (el.offsetHeight * tf.scale - window.innerHeight) / 2)
    tf.x = Math.min(maxX, Math.max(-maxX, tf.x))
    tf.y = Math.min(maxY, Math.max(-maxY, tf.y))
  }

  /** 以视口坐标为焦点缩放（焦点保持不动）；wrap 布局中心即视口中心 */
  function zoomAt(clientX: number, clientY: number, nextScale: number, animate: boolean) {
    const tf = tfRef.current
    const s1 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
    if (s1 === MIN_SCALE) {
      tf.scale = MIN_SCALE
      tf.x = 0
      tf.y = 0
    } else {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const k = s1 / tf.scale
      const dx = clientX - (cx + tf.x)
      const dy = clientY - (cy + tf.y)
      tf.x = clientX - cx - dx * k
      tf.y = clientY - cy - dy * k
      tf.scale = s1
      clampPan()
    }
    applyTransform(animate)
  }

  function toggleZoom(clientX: number, clientY: number) {
    zoomAt(clientX, clientY, tfRef.current.scale > MIN_SCALE ? MIN_SCALE : ZOOM_STEP, true)
  }

  /** 取消挂起的长按保存 */
  function cancelLongPress() {
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = undefined
  }

  /** 长按弹出保存确认（仅原生端触屏）：按住 500ms 未移动即触发 */
  function startLongPress() {
    cancelLongPress()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = undefined
      // 已按长按处理，抬手不再视为点按/双击
      const g = gestureRef.current
      g.moved = true
      g.lastTapTime = 0
      // 触觉反馈（WebView 无权限时静默失败）
      navigator.vibrate?.(15)
      setSaveSheetOpen(true)
    }, LONG_PRESS_MS)
  }

  /** 取当前展示图片的二进制：优先复用 object URL，退回 fetchStateless 拉取 */
  async function loadDisplayedBlob(): Promise<Blob> {
    const img = wrapRef.current?.querySelector("img")
    const src = img?.currentSrc || img?.src
    if (src?.startsWith("blob:")) {
      const blob = await (await fetch(src)).blob()
      if (blob.size > 0) return blob
    }
    const res = await fetchStateless({
      method: "GET",
      url,
      redirect: "manual",
      responseType: "arraybuffer",
    })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    const type = headerSingle(res.headers, "content-type") ?? "image/jpeg"
    return new Blob([await res.arrayBuffer()], { type })
  }

  async function saveImage() {
    if (saving) return
    setSaving(true)
    try {
      const blob = await loadDisplayedBlob()
      await YsuFile.saveImageToGallery({
        base64: await blobToBase64(blob),
        mimeType: blob.type || "image/jpeg",
        fileName: `skbird_${Date.now()}.${extForMime(blob.type || "image/jpeg")}`,
      })
      toast.success(t("skbird.imageSaved"))
    } catch (err) {
      console.warn("[skbird] 保存图片失败:", err)
      toast.error(t("skbird.imageSaveFailed"))
    } finally {
      setSaving(false)
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    wrapRef.current?.setPointerCapture(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gestureRef.current
    if (pointersRef.current.size === 1) {
      g.downX = g.lastX = e.clientX
      g.downY = g.lastY = e.clientY
      g.moved = false
      if (native && e.pointerType === "touch") startLongPress()
    } else if (pointersRef.current.size === 2) {
      cancelLongPress()
      const [a, b] = [...pointersRef.current.values()]
      g.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      g.pinchScale = tfRef.current.scale
      g.moved = true // 双指参与后不再算点按
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointersRef.current.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    const g = gestureRef.current
    const tf = tfRef.current
    if (pointersRef.current.size === 2) {
      // 捏合：中点位移平移 + 以中点为焦点缩放
      const [a, b] = [...pointersRef.current.values()]
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      const midX = (a!.x + b!.x) / 2
      const midY = (a!.y + b!.y) / 2
      tf.x += midX - g.lastX
      tf.y += midY - g.lastY
      g.lastX = midX
      g.lastY = midY
      zoomAt(midX, midY, g.pinchScale * (dist / g.pinchDist), false)
    } else if (pointersRef.current.size === 1) {
      const dx = e.clientX - g.lastX
      const dy = e.clientY - g.lastY
      g.lastX = e.clientX
      g.lastY = e.clientY
      if (!g.moved && Math.hypot(e.clientX - g.downX, e.clientY - g.downY) > TAP_SLOP_PX) {
        g.moved = true
        cancelLongPress()
      }
      if (tf.scale > MIN_SCALE) {
        tf.x += dx
        tf.y += dy
        clampPan()
        applyTransform(false)
      }
    }
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const g = gestureRef.current
    const wasTap = pointersRef.current.size === 1 && !g.moved
    pointersRef.current.delete(e.pointerId)
    cancelLongPress()
    if (pointersRef.current.size === 1) {
      // 双指抬起一只：以剩余手指位置重启单指拖拽
      const [rest] = [...pointersRef.current.values()]
      g.downX = g.lastX = rest!.x
      g.downY = g.lastY = rest!.y
      g.moved = true
      return
    }
    if (!wasTap) return
    if (e.pointerType === "mouse") {
      toggleZoom(e.clientX, e.clientY)
      return
    }
    // 触屏：双击缩放（单击不动作，避免延迟）
    const now = performance.now()
    const isDoubleTap =
      now - g.lastTapTime < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - g.lastTapX, e.clientY - g.lastTapY) < 40
    if (isDoubleTap) {
      g.lastTapTime = 0
      toggleZoom(e.clientX, e.clientY)
    } else {
      g.lastTapTime = now
      g.lastTapX = e.clientX
      g.lastTapY = e.clientY
    }
  }

  const shown = entered && !closing

  return (
    <>
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/85 transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        onClick={beginClose}
        role="presentation"
      >
        <button
          type="button"
          aria-label={t("skbird.closeImage")}
          onClick={beginClose}
          className="absolute top-4 right-4 z-10 rounded-none bg-white/10 p-2 text-white transition-colors hover:bg-white/25"
        >
          <X className="size-5" />
        </button>
        {/* 图片区：点击不关闭；桌面点击/滚轮缩放、拖拽平移，移动端双击/捏合/拖动，原生端长按弹出保存抽屉 */}
        <div
          ref={wrapRef}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onContextMenu={native ? (e) => e.preventDefault() : undefined}
          onWheel={(e) => {
            const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
            zoomAt(e.clientX, e.clientY, tfRef.current.scale * factor, false)
          }}
          className={`max-h-full max-w-full touch-none select-none ${
            zoomedIn ? "cursor-move" : "cursor-zoom-in"
          }`}
          role="presentation"
        >
          <SkbirdImage
            url={url}
            alt={alt}
            className={`max-h-[90vh] max-w-[92vw] object-contain transition-opacity duration-200 ${
              shown ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
      </div>
      {native ? (
        <SaveSheet
          open={saveSheetOpen}
          onOpenChange={setSaveSheetOpen}
          saving={saving}
          onSave={() => void saveImage()}
        />
      ) : null}
    </>
  )
}

/** 保存确认抽屉。平级于大图根节点渲染：portal 点击事件不再冒泡到大图背景的
 * 关闭处理器（React 合成事件会穿过 portal 沿 React 树冒泡，放在根节点内会让
 * 点“保存/取消”连带关闭大图）。 */
function SaveSheet({
  open,
  onOpenChange,
  saving,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  saving: boolean
  onSave: () => void
}) {
  const { t } = useTranslation()
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("skbird.saveImageTitle")}</DrawerTitle>
          <DrawerDescription>{t("skbird.saveImageDesc")}</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter className="flex-row gap-3">
          <DrawerClose asChild>
            <Button variant="outline" className="flex-1">
              {t("skbird.saveImageCancel")}
            </Button>
          </DrawerClose>
          <Button className="flex-1" disabled={saving} onClick={() => onSave()}>
            {t("skbird.saveImageConfirm")}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/**
 * 森空鸟 CDN 图片。双端统一走 fetchStateless 拉取后转 object URL：
 * - Native：WebView 默认拦截 https 页面加载 http 子资源（mixed content）。
 *
 * 例外：HTTPS 直链（如微信头像 thirdwx.qlogo.cn）无 mixed content 问题，
 * 也不需 activation 头，直接用 <img> 加载。
 *
 * zoomable：点击打开全屏查看器。桌面端点击/滚轮以光标为焦点缩放、拖拽平移；
 * 移动端双击缩放、捏合缩放、单指拖动；点击空白处或 Esc 关闭。
 * 原生端（Capacitor）触屏长按图片弹出抽屉确认后保存到系统相册（Web 端用浏览器自带的长按菜单）。
 * zoomUrl 指定放大用的大图（未指定则复用当前 src，无额外请求）。
 */
export function SkbirdImage({
  url,
  alt,
  className,
  zoomable = false,
  zoomUrl,
}: {
  url: string
  alt: string
  className?: string
  zoomable?: boolean
  zoomUrl?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const direct = url.startsWith("https://")

  useEffect(() => {
    if (direct) return
    let cancelled = false
    let objectUrl: string | null = null
    setSrc(null)
    setFailed(false)
    fetchStateless({
      method: "GET",
      url,
      redirect: "manual",
      // CapacitorHttp 的二进制响应类型是 arraybuffer，原生桥接返回 base64
      // 字符串，再由 cookie.ts 的 arrayBuffer() 统一解码。
      responseType: "arraybuffer",
    })
      .then(async (res) => {
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
        const type = headerSingle(res.headers, "content-type") ?? "image/jpeg"
        const blob = new Blob([await res.arrayBuffer()], { type })
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, direct])

  if (!direct) {
    if (failed) return null
    if (!src) return <Skeleton className={className} />
  }
  const showSrc = direct ? url : src!

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- object URL/外部直链，无需 Next 图片优化 */}
      <img
        src={showSrc}
        alt={alt}
        draggable={false}
        className={`${className ?? ""} ${zoomable ? "cursor-zoom-in" : ""}`}
        onClick={zoomable ? () => setZoomed(true) : undefined}
      />
      {zoomable && zoomed ? (
        <Lightbox url={zoomUrl ?? url} alt={alt} onClose={() => setZoomed(false)} />
      ) : null}
    </>
  )
}
