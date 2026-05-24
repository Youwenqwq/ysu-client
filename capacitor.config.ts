import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.youwenqwq.ysuclient.demo',
  appName: '燕大终端(演示版)',
  webDir: 'dist',
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
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
};

export default config;
