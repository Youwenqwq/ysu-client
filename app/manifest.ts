import type { MetadataRoute } from "next"
import { appIdentity } from "./composition/identity"

export const dynamic = "force-static"

/**
 * Semantic shortcut URLs: the manifest is static, so shortcuts point at stable
 * semantic deep-link destinations that the runtime resolves to the live plugin
 * page (see `lib/navigation/deep-link.ts`). No plugin ids are baked in here.
 */
function semanticShortcutHref(id: string): string {
  return `dashboard/plugin?route=${encodeURIComponent(id)}`
}

type LocalizedManifest = MetadataRoute.Manifest & {
  name_localized?: Record<string, string>
  short_name_localized?: Record<string, string>
  description_localized?: Record<string, string>
  shortcuts_localized?: Record<string, NonNullable<MetadataRoute.Manifest["shortcuts"]>>
}

export default function manifest(): LocalizedManifest {
  const basePath = process.env.APP_BASE_PATH || ""

  return {
    id: `${basePath}/`,
    name: appIdentity.name,
    short_name: appIdentity.shortName,
    description: appIdentity.description,
    lang: "zh-CN",
    dir: "ltr",
    name_localized: {
      en: appIdentity.nameEn,
    },
    short_name_localized: {
      en: appIdentity.nameEn,
    },
    description_localized: {
      en: appIdentity.descriptionEn,
    },
    shortcuts: appIdentity.shortcuts?.map((shortcut) => ({
      name: shortcut.name,
      short_name: shortcut.name,
      description: shortcut.name,
      url: semanticShortcutHref(shortcut.id),
      icons: [
        {
          src: "icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
        },
      ],
    })) ?? [],
    shortcuts_localized: {
      en: appIdentity.shortcuts?.map((shortcut) => ({
        name: shortcut.nameEn,
        short_name: shortcut.nameEn,
        description: shortcut.nameEn,
        url: semanticShortcutHref(shortcut.id),
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      })) ?? [],
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
      },
      {
        src: "icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
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
