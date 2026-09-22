/**
 * Capacitor 原生文件插件桥接。
 *
 * 对应原生插件: com.youwenqwq.ysuclient.YsuFilePlugin
 */
import { registerPlugin } from "@capacitor/core"

export interface YsuFilePlugin {
  downloadApk(options: { url: string; fileName?: string }): Promise<{ path: string }>
  installApk(options: { path: string }): Promise<void>
  clearDirectory(options: { path?: string }): Promise<void>
  saveImageToGallery(options: {
    /** 图片二进制内容的 base64 编码 */
    base64: string
    /** MIME 类型，默认 image/jpeg */
    mimeType?: string
    /** 含扩展名的文件名，缺省由原生端生成 */
    fileName?: string
  }): Promise<{ uri: string }>
  addListener(
    eventName: "downloadProgress",
    listener: (state: { percent: number }) => void
  ): Promise<{ remove: () => void }>
}

export const YsuFile = registerPlugin<YsuFilePlugin>("YsuFile")
