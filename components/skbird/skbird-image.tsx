"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { fetchStateless, headerSingle } from "@/lib/cookie";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n/use-translation";

/** 关闭动画时长，与过渡类 duration 匹配 */
const LIGHTBOX_TRANSITION_MS = 200;

const MIN_SCALE = 1;
const MAX_SCALE = 5;
/** 点击/双击放大到的倍率 */
const ZOOM_STEP = 2.5;
const DOUBLE_TAP_MS = 300;
/** 位移小于该值视为点按而非拖拽 */
const TAP_SLOP_PX = 8;

function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [zoomedIn, setZoomedIn] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** 当前变换。手势期间直写 DOM，不进 React state */
  const tfRef = useRef({ scale: 1, x: 0, y: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
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
  });

  // 挂载后下一帧进入，触发开启过渡
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 打开期间锁定背景滚动 + Esc 关闭
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") beginClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function beginClose() {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, LIGHTBOX_TRANSITION_MS);
  }

  function applyTransform(animate: boolean) {
    const el = wrapRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 200ms ease-out" : "none";
    const { scale, x, y } = tfRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    setZoomedIn(scale > MIN_SCALE);
  }

  /** 拖拽边界：图片不拖出视口 */
  function clampPan() {
    const el = wrapRef.current;
    if (!el) return;
    const tf = tfRef.current;
    const maxX = Math.max(0, (el.offsetWidth * tf.scale - window.innerWidth) / 2);
    const maxY = Math.max(0, (el.offsetHeight * tf.scale - window.innerHeight) / 2);
    tf.x = Math.min(maxX, Math.max(-maxX, tf.x));
    tf.y = Math.min(maxY, Math.max(-maxY, tf.y));
  }

  /** 以视口坐标为焦点缩放（焦点保持不动）；wrap 布局中心即视口中心 */
  function zoomAt(clientX: number, clientY: number, nextScale: number, animate: boolean) {
    const tf = tfRef.current;
    const s1 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    if (s1 === MIN_SCALE) {
      tf.scale = MIN_SCALE;
      tf.x = 0;
      tf.y = 0;
    } else {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const k = s1 / tf.scale;
      const dx = clientX - (cx + tf.x);
      const dy = clientY - (cy + tf.y);
      tf.x = clientX - cx - dx * k;
      tf.y = clientY - cy - dy * k;
      tf.scale = s1;
      clampPan();
    }
    applyTransform(animate);
  }

  function toggleZoom(clientX: number, clientY: number) {
    zoomAt(clientX, clientY, tfRef.current.scale > MIN_SCALE ? MIN_SCALE : ZOOM_STEP, true);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    wrapRef.current?.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    if (pointersRef.current.size === 1) {
      g.downX = g.lastX = e.clientX;
      g.downY = g.lastY = e.clientY;
      g.moved = false;
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      g.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      g.pinchScale = tfRef.current.scale;
      g.moved = true; // 双指参与后不再算点按
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointersRef.current.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const g = gestureRef.current;
    const tf = tfRef.current;
    if (pointersRef.current.size === 2) {
      // 捏合：中点位移平移 + 以中点为焦点缩放
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const midX = (a!.x + b!.x) / 2;
      const midY = (a!.y + b!.y) / 2;
      tf.x += midX - g.lastX;
      tf.y += midY - g.lastY;
      g.lastX = midX;
      g.lastY = midY;
      zoomAt(midX, midY, g.pinchScale * (dist / g.pinchDist), false);
    } else if (pointersRef.current.size === 1) {
      const dx = e.clientX - g.lastX;
      const dy = e.clientY - g.lastY;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      if (!g.moved && Math.hypot(e.clientX - g.downX, e.clientY - g.downY) > TAP_SLOP_PX) {
        g.moved = true;
      }
      if (tf.scale > MIN_SCALE) {
        tf.x += dx;
        tf.y += dy;
        clampPan();
        applyTransform(false);
      }
    }
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const g = gestureRef.current;
    const wasTap = pointersRef.current.size === 1 && !g.moved;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 1) {
      // 双指抬起一只：以剩余手指位置重启单指拖拽
      const [rest] = [...pointersRef.current.values()];
      g.downX = g.lastX = rest!.x;
      g.downY = g.lastY = rest!.y;
      g.moved = true;
      return;
    }
    if (!wasTap) return;
    if (e.pointerType === "mouse") {
      toggleZoom(e.clientX, e.clientY);
      return;
    }
    // 触屏：双击缩放（单击不动作，避免延迟）
    const now = performance.now();
    const isDoubleTap =
      now - g.lastTapTime < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - g.lastTapX, e.clientY - g.lastTapY) < 40;
    if (isDoubleTap) {
      g.lastTapTime = 0;
      toggleZoom(e.clientX, e.clientY);
    } else {
      g.lastTapTime = now;
      g.lastTapX = e.clientX;
      g.lastTapY = e.clientY;
    }
  }

  const shown = entered && !closing;

  return (
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
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25"
      >
        <X className="size-5" />
      </button>
      {/* 图片区：点击不关闭；桌面点击/滚轮缩放、拖拽平移，移动端双击/捏合/拖动 */}
      <div
        ref={wrapRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          zoomAt(e.clientX, e.clientY, tfRef.current.scale * factor, false);
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
  );
}

/**
 * 森空鸟 CDN 图片。双端统一走 fetchStateless 拉取后转 object URL：
 * - Web：<img> 无法携带 activation 头，且 CDN 为明文 HTTP（mixed content）；
 * - Native：WebView 默认拦截 https 页面加载 http 子资源（mixed content）。
 *
 * 例外：HTTPS 直链（如微信头像 thirdwx.qlogo.cn）无 mixed content 问题，
 * 也不需 activation 头，直接用 <img> 加载。
 *
 * zoomable：点击打开全屏查看器。桌面端点击/滚轮以光标为焦点缩放、拖拽平移；
 * 移动端双击缩放、捏合缩放、单指拖动；点击空白处或 Esc 关闭。
 * zoomUrl 指定放大用的大图（未指定则复用当前 src，无额外请求）。
 */
export function SkbirdImage({
  url,
  alt,
  className,
  zoomable = false,
  zoomUrl,
}: {
  url: string;
  alt: string;
  className?: string;
  zoomable?: boolean;
  zoomUrl?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const direct = url.startsWith("https://");

  useEffect(() => {
    if (direct) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    fetchStateless({ method: "GET", url, redirect: "manual", responseType: "base64" })
      .then(async (res) => {
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const type = headerSingle(res.headers, "content-type") ?? "image/jpeg";
        const blob = new Blob([await res.arrayBuffer()], { type });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, direct]);

  if (!direct) {
    if (failed) return null;
    if (!src) return <Skeleton className={className} />;
  }
  const showSrc = direct ? url : src!;

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
  );
}
