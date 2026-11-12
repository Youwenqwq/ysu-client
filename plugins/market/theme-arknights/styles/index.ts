import { baseCss } from "./base"
import { componentsCss } from "./components"
import { hudCss } from "./hud"
import { tokensCss } from "./tokens"

export const arknightsThemeCss = [tokensCss, baseCss, hudCss, componentsCss].join("\n")
