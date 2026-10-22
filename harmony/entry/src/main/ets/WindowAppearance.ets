import { window } from '@kit.ArkUI';

/** Physical pixels, converted to CSS pixels by the page's actual devicePixelRatio. */
export interface WindowSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function readWindowSafeArea(mainWindow: window.Window): WindowSafeArea {
  const system = mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
  const indicator = mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
  const cutout = mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_CUTOUT);
  // These regions overlap. Do not add them or treat the keyboard as a navigation inset.
  return {
    top: Math.max(system.topRect.height, indicator.topRect.height, cutout.topRect.height),
    right: Math.max(system.rightRect.width, indicator.rightRect.width, cutout.rightRect.width),
    bottom: Math.max(system.bottomRect.height, indicator.bottomRect.height, cutout.bottomRect.height),
    left: Math.max(system.leftRect.width, indicator.leftRect.width, cutout.leftRect.width)
  };
}

export async function applyWindowTheme(mainWindow: window.Window, dark: boolean): Promise<void> {
  // ArkWeb paints one continuous glass layer beneath the visible system bars.
  const foreground = dark ? '#ffffff' : '#000000';
  await mainWindow.setWindowSystemBarProperties({
    statusBarColor: '#00000000',
    navigationBarColor: '#00000000',
    statusBarContentColor: foreground,
    navigationBarContentColor: foreground,
    enableStatusBarAnimation: false,
    enableNavigationBarAnimation: false
  });
}
