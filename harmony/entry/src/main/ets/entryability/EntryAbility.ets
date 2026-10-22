import { UIAbility, ConfigurationConstant } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { applyWindowTheme } from '../WindowAppearance';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(windowStage: window.WindowStage): void {
    const mainWindow = windowStage.getMainWindowSync();
    mainWindow.setWindowLayoutFullScreen(true).catch(() => {}).then(() => {
      const dark = this.context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      applyWindowTheme(mainWindow, dark).catch(() => {});
      windowStage.loadContent('pages/Index');
    });
  }
}
