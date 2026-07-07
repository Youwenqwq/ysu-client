import { APP_VERSION } from "@/lib/version";
import { useSettingsStore } from "@/lib/stores/settings";

export const DEFAULT_DESKTOP_UA =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 ysu-client/${APP_VERSION}`;

export const USER_AGENT_PRESETS = [
  {
    id: "default",
    label: "App default",
    value: DEFAULT_DESKTOP_UA,
  },
  {
    id: "windows-chrome",
    label: "Windows Chrome",
    value: DEFAULT_DESKTOP_UA,
  },
  {
    id: "android-chrome",
    label: "Android Chrome",
    value:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  },
  {
    id: "ios-safari",
    label: "iOS Safari",
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
] as const;

export function normalizeCustomUserAgent(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function getCustomUserAgent(): string {
  const custom = normalizeCustomUserAgent(useSettingsStore.getState().customUserAgent);
  return custom || DEFAULT_DESKTOP_UA;
}
