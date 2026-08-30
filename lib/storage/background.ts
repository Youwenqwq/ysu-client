/**
 * 背景图片存储。
 *
 * 与头像相同：token（固定文件名）持久化在 settings store，
 * 渲染统一走 `useStoredMediaUrl`；Web 端 blob 存 IndexedDB，
 * 原生端存 Filesystem。
 */

import { Filesystem, Directory } from "@capacitor/filesystem"
import { Capacitor } from "@capacitor/core"
import { isCapacitor } from "@/lib/native/platform"
import { idbReadBlob, idbWriteBlob, idbDeleteBlob, idbBlobUrl } from "./idb-media"

const BG_FILE = "background-image.jpg"

export async function saveBackgroundImage(dataUrl: string): Promise<string> {
  if (!isCapacitor()) {
    const blob = await (await fetch(dataUrl)).blob()
    await idbWriteBlob(BG_FILE, blob)
    return BG_FILE
  }

  const base64 = dataUrl.split(",")[1]
  if (!base64) throw new Error("Invalid image data")
  await Filesystem.writeFile({
    path: BG_FILE,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  })
  return BG_FILE
}

export async function removeBackgroundImage(): Promise<void> {
  if (!isCapacitor()) {
    await idbDeleteBlob(BG_FILE)
    return
  }
  try {
    await Filesystem.deleteFile({
      path: BG_FILE,
      directory: Directory.Data,
    })
  } catch {
    // ignore not found
  }
}

export async function loadBackgroundImage(): Promise<string | null> {
  if (!isCapacitor()) {
    const blob = await idbReadBlob(BG_FILE)
    return blob ? idbBlobUrl(BG_FILE, blob) : null
  }
  try {
    const { uri } = await Filesystem.getUri({
      path: BG_FILE,
      directory: Directory.Data,
    })
    return `${Capacitor.convertFileSrc(uri)}?t=${Date.now()}`
  } catch {
    return null
  }
}
