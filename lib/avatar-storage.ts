/** 头像存储 —— Capacitor Filesystem API */

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

const AVATAR_FILE = "avatar-image.jpg";

export async function saveAvatarImage(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Invalid image data");
  await Filesystem.writeFile({
    path: AVATAR_FILE,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({
    path: AVATAR_FILE,
    directory: Directory.Data,
  });
  return `${Capacitor.convertFileSrc(uri)}?t=${Date.now()}`;
}

export async function removeAvatarImage(): Promise<void> {
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
