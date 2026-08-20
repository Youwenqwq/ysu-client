/**
 * Web 端本地媒体存储：IndexedDB blob + blob URL 缓存。
 *
 * Web 平台没有 Capacitor Filesystem（其 web 实现返回 IndexedDB 内部键，
 * 不能直接当 <img>/CSS url() 使用），因此头像/背景图在 Web 端改为
 * 浏览器原生方式：blob 持久化到 IndexedDB，渲染时经 createObjectURL
 * 生成可用的 blob URL。
 *
 * blob URL 按 key 缓存并在此模块统一 revoke（重写/删除时），避免泄漏；
 * 页面卸载后浏览器自动回收，跨会话不残留。
 */

const DB_NAME = "ysu-media";
const STORE = "files";

const blobUrlCache = new Map<string, string>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function revokeCached(key: string): void {
  const url = blobUrlCache.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlCache.delete(key);
  }
}

/** 写入（或覆盖）key 对应的 blob，使旧的 blob URL 失效。 */
export async function idbWriteBlob(key: string, blob: Blob): Promise<void> {
  revokeCached(key);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ key, blob, ts: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 删除 key 对应的 blob，并使旧的 blob URL 失效。 */
export async function idbDeleteBlob(key: string): Promise<void> {
  revokeCached(key);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 读取 key 对应的 blob；不存在返回 null。 */
export async function idbReadBlob(key: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    const record = await new Promise<{ blob: Blob } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as { blob: Blob } | undefined);
      req.onerror = () => reject(req.error);
    });
    return record?.blob ?? null;
  } finally {
    db.close();
  }
}

/**
 * 返回 key 对应的 blob URL（缓存命中直接复用）。
 * 调用前应已通过 idbReadBlob 确认 blob 存在；重写/删除会先 revoke。
 */
export function idbBlobUrl(key: string, blob: Blob): string {
  const cached = blobUrlCache.get(key);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(key, url);
  return url;
}
