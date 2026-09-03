/**
 * 玩具箱（extras）：与学校教务无关的第三方功能注册表。
 *
 * 每个 feature 自包含于 lib/extras/<id>/，通过此注册表向 dashboard
 * layout 贡献导航项与页面标题；不接入 AcademicProvider 体系，
 * 不触碰教务会话状态。新增功能 = 新目录 + 此处注册一行。
 */
import type { LucideIcon } from "lucide-react"
import { skbirdFeature } from "./skbird/feature"
import { meterFeature } from "./meter/feature"
import { epayFeature } from "./epay/feature"
import { ecardFeature } from "./ecard/feature"

export interface ExtraFeature {
  id: string
  nav: {
    /** i18n key，如 "skbird.nav" */
    titleKey: string
    url: string
    icon: LucideIcon
  }
  /** path → i18n key，合并进 dashboard layout 的页面标题表 */
  titleKeys: Record<string, string>
}

export const EXTRA_FEATURES: ExtraFeature[] = [skbirdFeature, meterFeature, epayFeature, ecardFeature]
