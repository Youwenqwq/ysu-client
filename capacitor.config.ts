import type { CapacitorConfig } from "@capacitor/cli"
import { appIdentity } from "./app/composition/identity"

const config: CapacitorConfig = {
  appId: appIdentity.applicationId,
  appName: appIdentity.name,
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
