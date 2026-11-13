import type { MetadataRoute } from "next"

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
    name: "酸橙盒",
    short_name: "酸橙盒",
    description: "面向燕山大学教务系统的第三方客户端",
    lang: "zh-CN",
    dir: "ltr",
    name_localized: {
      en: "Orahako",
    },
    short_name_localized: {
      en: "Orahako",
    },
    description_localized: {
      en: "A third-party client for the Yanshan University academic system.",
    },
    shortcuts: [
      {
        name: "课程表",
        short_name: "课表",
        description: "查看课程表",
        url: semanticShortcutHref("schedule"),
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "成绩查询",
        short_name: "成绩",
        description: "查询课程成绩",
        url: semanticShortcutHref("grades"),
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "考试安排",
        short_name: "考试",
        description: "查看考试安排",
        url: semanticShortcutHref("exams"),
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    ],
    shortcuts_localized: {
      en: [
        {
          name: "Class Schedule",
          short_name: "Schedule",
          description: "View your class schedule",
          url: semanticShortcutHref("schedule"),
          icons: [
            {
              src: "icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
          ],
        },
        {
          name: "Grades",
          short_name: "Grades",
          description: "View your course grades",
          url: semanticShortcutHref("grades"),
          icons: [
            {
              src: "icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
          ],
        },
        {
          name: "Exams",
          short_name: "Exams",
          description: "View your exam schedule",
          url: semanticShortcutHref("exams"),
          icons: [
            {
              src: "icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
          ],
        },
      ],
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
