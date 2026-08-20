import type { MetadataRoute } from "next"

export const dynamic = "force-static"

type LocalizedManifest = MetadataRoute.Manifest & {
  name_localized?: Record<string, string>
  short_name_localized?: Record<string, string>
  description_localized?: Record<string, string>
}

export default function manifest(): LocalizedManifest {
  const basePath = process.env.APP_BASE_PATH || ""

  return {
    id: `${basePath}/`,
    name: "燕大终端",
    short_name: "燕大终端",
    description: "面向燕山大学教务系统的第三方客户端",
    lang: "zh-CN",
    dir: "ltr",
    name_localized: {
      en: "YSU Terminal",
    },
    short_name_localized: {
      en: "YSU Terminal",
    },
    description_localized: {
      en: "A third-party client for the Yanshan University academic system.",
    },
    start_url: ".",
    scope: ".",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
