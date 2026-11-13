import { Bike } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { PerlicaPage } from "./page"
import { PerlicaSettingsPage } from "./settings-page"
import { perlicaTranslations } from "./i18n"
import {
  PERLICA_PAGE_INDEX,
  PERLICA_PAGE_SETTINGS,
  PERLICA_ROUTE_INDEX,
  PERLICA_ROUTE_SETTINGS,
} from "./constants"
import "./styles/leaflet.css"
import "./style.css"

export const manifest: PluginManifest = {
  id: "community.perlica-toybox",
  name: "Perlica",
  version: "1.0.0",
  apiVersion: 1,
  minAppVersion: "0.15.0",
  kind: "feature",
  entry: "dist/index.js",
  styles: ["dist/index.css"],
  description: "佩黎卡共享单车：地图找车、扫码解锁、骑行中控制、骑行记录与账户信息。",
}

export const definition = definePlugin((ctx) => {
  ctx.i18n.register(perlicaTranslations)
  ctx.ui.registerPage({
    id: PERLICA_PAGE_INDEX,
    route: PERLICA_ROUTE_INDEX,
    title: "Perlica",
    titleKey: "perlica.title",
    component: PerlicaPage,
    fullscreen: true,
  })
  ctx.ui.registerPage({
    id: PERLICA_PAGE_SETTINGS,
    route: PERLICA_ROUTE_SETTINGS,
    title: "Perlica Settings",
    titleKey: "perlica.settingsTitle",
    component: PerlicaSettingsPage,
    parent: PERLICA_PAGE_INDEX,
  })
  ctx.ui.registerNavigation({
    id: "perlica",
    title: "Perlica",
    titleKey: "perlica.nav",
    page: PERLICA_PAGE_INDEX,
    icon: Bike,
    group: "extras",
  })
})

export default definition
