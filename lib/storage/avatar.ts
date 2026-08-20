/**
 * 头像存储。
 *
 * - 原生（Capacitor）：写入 Filesystem，token 为固定文件名；
 *   load 时经 convertFileSrc 得到可渲染 URL。
 * - Web：blob 写入 IndexedDB（浏览器原生方式），token 同为固定文件名；
 *   load 时经 createObjectURL 得到 blob URL。
 *
 * settings store 持久化的是 token（非 URL），渲染统一走
 * `useStoredMediaUrl`（见 lib/storage/media.ts）。
 */

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { isCapacitor } from "@/lib/native/platform";
import { idbReadBlob, idbWriteBlob, idbDeleteBlob, idbBlobUrl } from "./idb-media";

const AVATAR_FILE = "avatar-image.jpg";

export async function saveAvatarImage(dataUrl: string): Promise<string> {
  if (!isCapacitor()) {
    const blob = await (await fetch(dataUrl)).blob();
    await idbWriteBlob(AVATAR_FILE, blob);
    return AVATAR_FILE;
  }

  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Invalid image data");
  await Filesystem.writeFile({
    path: AVATAR_FILE,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });
  return AVATAR_FILE;
}

export async function removeAvatarImage(): Promise<void> {
  if (!isCapacitor()) {
    await idbDeleteBlob(AVATAR_FILE);
    return;
  }
  try {
    await Filesystem.deleteFile({
      path: AVATAR_FILE,
      directory: Directory.Data,
    });
  } catch {
    // ignore not found
  }
}

export async function loadAvatarImage(): Promise<string | null> {
  if (!isCapacitor()) {
    const blob = await idbReadBlob(AVATAR_FILE);
    return blob ? idbBlobUrl(AVATAR_FILE, blob) : null;
  }
  try {
    const { uri } = await Filesystem.getUri({
      path: AVATAR_FILE,
      directory: Directory.Data,
    });
    return `${Capacitor.convertFileSrc(uri)}?t=${Date.now()}`;
  } catch {
    return null;
  }
}
