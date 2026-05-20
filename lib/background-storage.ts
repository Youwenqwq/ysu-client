/** 背景图片存储 —— Capacitor Filesystem API */

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

const BG_FILE = "background-image.jpg";

export async function saveBackgroundImage(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Invalid image data");
  await Filesystem.writeFile({
    path: BG_FILE,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({
    path: BG_FILE,
    directory: Directory.Data,
  });
  return `${Capacitor.convertFileSrc(uri)}?t=${Date.now()}`;
}

export async function removeBackgroundImage(): Promise<void> {
  try {
    await Filesystem.deleteFile({
      path: BG_FILE,
      directory: Directory.Data,
    });
  } catch {
    // ignore not found
  }
}

export async function loadBackgroundImage(): Promise<string | null> {
  try {
    const { uri } = await Filesystem.getUri({
      path: BG_FILE,
      directory: Directory.Data,
    });
    return `${Capacitor.convertFileSrc(uri)}?t=${Date.now()}`;
  } catch {
    return null;
  }
}

