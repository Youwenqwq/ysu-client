import type { MetadataRoute } from "next"

export const dynamic = "force-static"

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
    shortcuts: [
      {
        name: "课程表",
        short_name: "课表",
        description: "查看课程表",
        url: "dashboard/schedule/",
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
        url: "dashboard/grades/",
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
        url: "dashboard/exams/",
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
          url: "dashboard/schedule/",
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
          url: "dashboard/grades/",
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
          url: "dashboard/exams/",
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
