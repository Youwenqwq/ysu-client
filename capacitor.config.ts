import type { CapacitorConfig } from "@capacitor/cli"
import { officialAppIdentity } from "./plugins/official/app-config"

const config: CapacitorConfig = {
  appId: officialAppIdentity.applicationId,
  appName: officialAppIdentity.name,
  webDir: "dist",
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    CapacitorUpdater: {
      autoUpdate: false,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      resetWhenUpdate: true,
      appReadyTimeout: 15000,
    },
  },
}

export default config
