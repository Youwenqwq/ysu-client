import { academicBundle } from "@orahako/bundle-academic"
import { platformBundle } from "@orahako/bundle-platform"
import { ysuBundle } from "@orahako/bundle-ysu"
import { composeBundles, type CompositionLayer, type CompositionSource } from "@orahako/sdk"
import { appIdentity } from "./identity"
import { createOfficialPlugins } from "./plugins"

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"
const appBuild = process.env.NEXT_PUBLIC_APP_BUILD ?? "dev"
const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? ""
const marketUrl = ysuBundle.market.indexUrl
const { name: appName, nameEn: appNameEn, deepLinkScheme } = appIdentity
const repoUrl = "https://github.com/Youwenqwq/orahako"
const schools = [{ id: "ysu", name: "燕山大学", nameEn: "Yanshan University" }] as const

export type DeploymentTarget = "native" | "edgeone-pwa"

export const EDGEONE_PWA_DEPLOYMENT = "edgeone-pwa"

/** Only the EdgeOne deployment script sets this build-time marker. */
export function resolveDeploymentTarget(
  configured: string | undefined = process.env.NEXT_PUBLIC_APP_DEPLOYMENT
): DeploymentTarget {
  return configured === EDGEONE_PWA_DEPLOYMENT ? EDGEONE_PWA_DEPLOYMENT : "native"
}

export interface OfficialCompositionOptions {
  readonly deployment?: DeploymentTarget
}

const deployment: CompositionLayer = {
  id: "orahako.official.deployment",
  plugins: [
    { id: "orahako.runtime.installer", config: { marketUrl, appVersion } },
    { id: "orahako.runtime.router", config: { basePath } },
    { id: "orahako.runtime.navigation", config: { fallbackHref: "/" } },
    {
      id: "orahako.analytics",
      config: { endpoint: "https://orahako.welain.com/api/stats", appVersion },
    },
    {
      id: "orahako.announcement",
      config: { endpoint: "https://orahako.welain.com/api/announcement" },
    },
    {
      id: "orahako.updater",
      config: {
        currentVersion: appVersion,
        manifestUrl: "https://orahako.welain.com/api/version",
        mirrors: [{ label: "GitHub 直连", value: "" }],
        mirrorableOrigins: ["https://github.com"],
        basePath,
        enableServiceWorker: process.env.NODE_ENV === "production",
      },
    },
    { id: "orahako.runtime.native-lifecycle", config: { deepLinkScheme } },
    { id: "orahako.shell", config: { appName, appNameEn } },
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
      config: { defaultLanding: academicBundle.defaults.landing },
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

const edgeonePwaLayer: CompositionLayer = {
  id: "orahako.official.edgeone-pwa",
  plugins: [
    {
      insert: [{ id: "orahako.activation", config: { required: true } }],
    },
  ],
}

export function createOfficialCompositionSource(
  options: OfficialCompositionOptions = {}
): CompositionSource {
  const deploymentTarget = options.deployment ?? resolveDeploymentTarget()
  const pwa = deploymentTarget === EDGEONE_PWA_DEPLOYMENT
  return {
    appVersion,
    appBuild,
    composition: composeBundles(
      "orahako.official",
      [platformBundle, academicBundle, ysuBundle],
      pwa ? [deployment, edgeonePwaLayer] : [deployment]
    ),
    plugins: createOfficialPlugins({ activation: pwa }),
  }
}

export const officialCompositionSource = createOfficialCompositionSource()
