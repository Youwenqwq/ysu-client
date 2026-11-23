import { academicBundle } from "@orahako/bundle-academic"
import { platformBundle } from "@orahako/bundle-platform"
import { ysuBundle } from "@orahako/bundle-ysu"
import { composeBundles, type CompositionLayer, type CompositionSource } from "@orahako/sdk"
import { appIdentity } from "./identity"
import { officialPlugins } from "./plugins"

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"
const appBuild = process.env.NEXT_PUBLIC_APP_BUILD ?? "dev"
const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? ""
const marketUrl = ysuBundle.market.indexUrl
const { name: appName, nameEn: appNameEn, deepLinkScheme } = appIdentity
const repoUrl = "https://github.com/Youwenqwq/orahako"
const schools = [{ id: "ysu", name: "燕山大学", nameEn: "Yanshan University" }] as const

const deployment: CompositionLayer = {
  id: "orahako.official.deployment",
  plugins: [
    { id: "orahako.runtime.installer", config: { marketUrl, appVersion } },
    { id: "orahako.runtime.router", config: { basePath } },
    { id: "orahako.runtime.navigation", config: { fallbackHref: "/" } },
    { id: "orahako.activation", config: { required: process.env.NODE_ENV === "production" } },
    {
      id: "orahako.analytics",
      config: { endpoint: "https://ysu.welain.com/api/stats", appVersion },
    },
    {
      id: "orahako.announcement",
      config: { endpoint: "https://ysu.welain.com/updates/announcement.json" },
    },
    {
      id: "orahako.updater",
      config: {
        currentVersion: appVersion,
        releaseBaseUrl: `${repoUrl}/releases/latest/download`,
        mirrors: [{ label: "GitHub 直连", value: "" }],
        mirrorableOrigins: ["https://github.com"],
        basePath,
      },
    },
    { id: "orahako.shell", config: { appName, appNameEn, deepLinkScheme } },
    {
      id: "orahako.profile",
      config: {
        appName,
        appNameEn,
        copyright: `© ${new Date().getFullYear()} Youwenqwq`,
        appVersion,
        appBuild,
        repoUrl,
        repoLabel: "Youwenqwq/orahako",
        license: "GPL-3.0",
        iconUrl: `${basePath}/icon.svg`,
      },
    },
    {
      id: "orahako.auth-ui",
      config: { schools, defaultLanding: academicBundle.defaults.landing },
    },
    {
      id: "orahako.onboarding",
      config: {
        marketUrl,
        schools: schools.map(({ id, name, nameEn }) => ({
          id,
          name,
          nameEn,
          ...(id === ysuBundle.defaults.schoolId ? { builtin: true } : {}),
        })),
      },
    },
  ],
}

export const officialCompositionSource: CompositionSource = {
  appVersion,
  appBuild,
  composition: composeBundles("orahako.official", [platformBundle, academicBundle, ysuBundle], [
    deployment,
  ]),
  plugins: officialPlugins,
}
