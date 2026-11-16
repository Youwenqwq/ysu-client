import type { CompositionIdentity, UpdateMirror } from "@orahako/plugin-sdk"

/**
 * Composition-owned build metadata. Runtime services receive the version as
 * configuration instead of importing the app-level version module.
 */
export { APP_VERSION as officialAppVersion, APP_BUILD as officialAppBuild } from "@orahako/plugin-ui/platform"

export interface OfficialSchoolChoice {
  id: string
  name: string
  nameEn?: string
  providerId: string
  online?: boolean
}

/** School choices declared by the official composition and shared by Shell UI. */
export const officialSchoolChoices: readonly OfficialSchoolChoice[] = [
  {
    id: "ysu",
    name: "燕山大学",
    nameEn: "Yanshan University",
    providerId: "ysu.provider",
  },
  {
    id: "zmu",
    name: "遵义医科大学",
    nameEn: "Zunyi Medical University",
    providerId: "zmu.provider",
    online: true,
  },
]

export const officialMarketUrl = "https://ysu.welain.com/updates/plugins.json"

/**
 * Official service choices. They live here and in `composition.ts` so a
 * replacement composition can point the generic runtime services elsewhere.
 */
export const officialAnalyticsEndpoint = "https://ysu.welain.com/api/stats"
export const officialAnnouncementUrl = "https://ysu.welain.com/updates/announcement.json"
export const officialReleaseBaseUrl =
  "https://github.com/Youwenqwq/orahako/releases/latest/download"
export const officialUpdateMirrors: readonly UpdateMirror[] = [
  { label: "GitHub 直连", value: "" },
]
export const officialMirrorableOrigins: readonly string[] = ["https://github.com"]

/** Project identity shown by official Shell surfaces such as the About page. */
export const officialAppRepo = "https://github.com/Youwenqwq/orahako"
export const officialAppLicense = "GPL-3.0"
export const officialAppCopyright = `© ${new Date().getFullYear()} Youwenqwq`

export const officialAppIdentity: CompositionIdentity = {
  name: "酸橙盒",
  shortName: "酸橙盒",
  nameEn: "Orahako",
  description: "面向燕山大学教务系统的第三方客户端",
  descriptionEn: "A third-party client for the Yanshan University academic system.",
  applicationId: "me.uwen.orahako",
  deepLinkScheme: "orahako",
  shortcuts: [
    { id: "schedule", name: "今日课表", nameEn: "Schedule" },
    { id: "grades", name: "成绩查询", nameEn: "Grades" },
    { id: "exams", name: "考试安排", nameEn: "Exams" },
  ],
}
