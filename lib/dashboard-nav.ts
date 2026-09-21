/**
 * 教务导航注册表：侧边栏与"我的"页共用的学术功能入口。
 *
 * 每个条目通过 `capability` 绑定 AcademicCapabilities 键；布局层据此过滤
 * 导航项并拦截直访路由。费用/玩具箱功能见 lib/fees、lib/extras。
 */
import {
  BookOpen,
  Calendar,
  CalendarDays,
  ClipboardCheck,
  FilePenLine,
  FileText,
  Gauge,
  GraduationCap,
  Hammer,
  LayoutDashboard,
  Lightbulb,
} from "lucide-react"
import { isDashboardFeatureAvailable, type DashboardFeature } from "@/lib/dashboard-features"
import { FEE_FEATURES } from "@/lib/fees/registry"
import type { AcademicCapabilities } from "@/providers/types"

export interface AcademicNavGroup {
  labelKey: string
  features: DashboardFeature[]
}

export const ACADEMIC_NAV_GROUPS: AcademicNavGroup[] = [
  {
    labelKey: "app.nav",
    features: [
      {
        id: "overview",
        nav: { titleKey: "app.overview", url: "/dashboard", icon: LayoutDashboard },
        titleKeys: { "/dashboard": "app.overview" },
      },
      {
        id: "grades",
        nav: { titleKey: "app.grades", url: "/dashboard/grades", icon: GraduationCap },
        titleKeys: { "/dashboard/grades": "app.grades" },
        capability: "grades",
      },
      {
        id: "schedule",
        nav: { titleKey: "app.schedule", url: "/dashboard/schedule", icon: Calendar },
        titleKeys: { "/dashboard/schedule": "app.schedule" },
        capability: "schedule",
      },
    ],
  },
  {
    labelKey: "me.sectionAcademic",
    features: [
      {
        id: "exams",
        nav: { titleKey: "app.exams", url: "/dashboard/exams", icon: FileText },
        titleKeys: { "/dashboard/exams": "app.exams" },
        capability: "exams",
      },
      {
        id: "makeup-exams",
        nav: { titleKey: "app.makeupExams", url: "/dashboard/makeup-exams", icon: FilePenLine },
        titleKeys: { "/dashboard/makeup-exams": "app.makeupExams" },
        capability: "makeupExams",
      },
      {
        id: "training-plan",
        nav: { titleKey: "app.trainingPlan", url: "/dashboard/training-plan", icon: BookOpen },
        titleKeys: { "/dashboard/training-plan": "app.trainingPlan" },
        capability: "trainingPlan",
      },
      {
        id: "evaluation",
        nav: { titleKey: "app.evaluation", url: "/dashboard/evaluation", icon: ClipboardCheck },
        titleKeys: { "/dashboard/evaluation": "app.evaluation" },
        capability: "evaluation",
      },
    ],
  },
  {
    labelKey: "me.sectionPlatforms",
    features: [
      {
        id: "labor",
        nav: { titleKey: "app.labor", url: "/dashboard/labor", icon: Hammer },
        titleKeys: { "/dashboard/labor": "app.labor" },
        capability: "laborEducation",
      },
      {
        id: "credits",
        nav: { titleKey: "app.credits", url: "/dashboard/credits", icon: Lightbulb },
        titleKeys: { "/dashboard/credits": "app.credits" },
        capability: "innovationCredits",
      },
      {
        id: "comprehensive",
        nav: { titleKey: "app.comprehensive", url: "/dashboard/comprehensive", icon: Gauge },
        titleKeys: { "/dashboard/comprehensive": "app.comprehensive" },
        capability: "comprehensiveEval",
      },
      {
        id: "school-schedule",
        nav: {
          titleKey: "app.schoolSchedule",
          url: "/dashboard/school-schedule",
          icon: CalendarDays,
        },
        titleKeys: { "/dashboard/school-schedule": "app.schoolSchedule" },
        capability: "schoolSchedule",
      },
    ],
  },
]

export const ACADEMIC_FEATURES: DashboardFeature[] = ACADEMIC_NAV_GROUPS.flatMap(
  (group) => group.features
)

/**
 * The capability blocking direct access to `pathname`, or null when the route
 * is available (or not capability-gated). Covers academic and fee features.
 */
export function blockedCapabilityForPath(
  pathname: string,
  capabilities: AcademicCapabilities
): keyof AcademicCapabilities | null {
  for (const feature of [...ACADEMIC_FEATURES, ...FEE_FEATURES]) {
    const gated = pathname === feature.nav.url || pathname.startsWith(`${feature.nav.url}/`)
    if (gated && !isDashboardFeatureAvailable(feature, capabilities)) {
      return feature.capability ?? null
    }
  }
  return null
}
