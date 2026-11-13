import type { PluginHttpService, PluginNativeService } from "@orahako/plugin-sdk"
import { isCapacitor } from "@/lib/native/platform"
import { OrahakoFile } from "@/lib/native/orahako-file"
import type { PluginServiceFactory } from "./runtime"

export const createPluginPlatformServices: PluginServiceFactory = (ctx) => {
  const http: PluginHttpService = {
    fetch: (input, init) => fetch(input, init),
  }
  const native: PluginNativeService = {
    isNative: isCapacitor(),
    saveImage: async (image, fileName) => {
      const base64 = await blobToBase64(image)
      return OrahakoFile.saveImageToGallery({ base64, mimeType: image.type, fileName })
    },
  }
  ctx.set("http", http)
  ctx.set("native", native)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}
