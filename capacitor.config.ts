import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "me.uwen.orahako",
  appName: "酸橙盒",
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
