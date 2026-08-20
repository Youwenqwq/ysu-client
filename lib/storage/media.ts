/**
 * 存储图片的解析 hook。
 *
 * settings store 里持久化的是稳定 token（文件 key，两端统一）；
 * 渲染时通过 load 函数解析出当前会话可用的 URL：
 * - 原生：Capacitor convertFileSrc 的 capacitor:// URL
 * - Web：IndexedDB blob 的 blob: URL
 *
 * 兼容旧数据：settings 里若已存了可直接渲染的 URL（capacitor://、
 * file://、http(s)、blob:、data:），则原样使用，不经过 load。
 */
import { useEffect, useState } from "react";

const RENDERABLE_URL_RE = /^(https?:|blob:|data:|capacitor:|file:)/i;

export function isRenderableUrl(value: string): boolean {
  return RENDERABLE_URL_RE.test(value);
}

export function useStoredMediaUrl(
  stored: string | undefined,
  load: () => Promise<string | null>,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!stored) {
      setUrl(null);
      return;
    }
    if (isRenderableUrl(stored)) {
      setUrl(stored);
      return;
    }
    load().then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [stored, load]);

  return url;
}
