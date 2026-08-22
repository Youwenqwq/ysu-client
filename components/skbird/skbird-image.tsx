"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { fetchStateless, headerSingle } from "@/lib/cookie";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n/use-translation";

/** 关闭动画时长，与过渡类 duration 匹配 */
const LIGHTBOX_TRANSITION_MS = 200;

function Lightbox({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const [scale, setScale] = useState(1);

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
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25"
      >
        <X className="size-5" />
      </button>
      {/* 图片区：点击不关闭，滚轮缩放 */}
      <div
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setScale((s) => Math.min(5, Math.max(0.4, s * factor)));
        }}
        className="max-h-full max-w-full cursor-zoom-in transition-transform duration-150"
        style={{ transform: `scale(${scale})` }}
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
 * zoomable：点击放大为全屏遮罩，点击任意处关闭；zoomUrl 指定放大用的大图
 * （未指定则复用当前 src，无额外请求）。
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
        className={`${className ?? ""} ${zoomable ? "cursor-zoom-in" : ""}`}
        onClick={zoomable ? () => setZoomed(true) : undefined}
      />
      {zoomable && zoomed ? (
        <Lightbox url={zoomUrl ?? url} alt={alt} onClose={() => setZoomed(false)} />
      ) : null}
    </>
  );
}
