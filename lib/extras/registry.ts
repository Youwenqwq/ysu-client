/**
 * 玩具箱（extras）：与学校教务无关的第三方功能注册表。
 *
 * 每个 feature 自包含于 lib/extras/<id>/，通过此注册表向 dashboard
 * layout 贡献导航项与页面标题；不接入 AcademicProvider 体系，
 * 不触碰教务会话状态。新增功能 = 新目录 + 此处注册一行。
 */
import type { DashboardFeature } from "@/lib/dashboard-features"
import { skbirdFeature } from "./skbird/feature"

export const EXTRA_FEATURES: DashboardFeature[] = [skbirdFeature]
