import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  BACK_PRIORITY,
  Badge,
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FilterChips,
  FilterOptionList,
  LoadingCards,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  SettingsSection,
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
  Spinner,
  ValidatingList,
  blurActiveElement,
  clampSettingNumber,
  cn,
} from "../src"

describe("ui-primitives utilities", () => {
  it("merges Tailwind classes deterministically via cn", () => {
    expect(cn("px-2 py-1", false && "hidden", "px-4")).toBe("py-1 px-4")
  })

  it("clamps setting numbers and falls back when input is NaN", () => {
    expect(clampSettingNumber("12", 6, 1, 24)).toBe(12)
    expect(clampSettingNumber("99", 6, 1, 24)).toBe(24)
    expect(clampSettingNumber("-5", 6, 1, 24)).toBe(1)
    expect(clampSettingNumber("abc", 6, 1, 24)).toBe(6)
  })

  it("is safe to call blurActiveElement in non-DOM environments", () => {
    expect(() => blurActiveElement()).not.toThrow()
  })

  it("defines monotonic back-layer priorities", () => {
    expect(BACK_PRIORITY.page).toBeLessThan(BACK_PRIORITY.gesture)
    expect(BACK_PRIORITY.gesture).toBeLessThan(BACK_PRIORITY.overlay)
    expect(BACK_PRIORITY.overlay).toBeLessThan(BACK_PRIORITY.foreground)
  })
})

describe("ui-primitives pure props-driven rendering", () => {
  it("renders foundational controls and composite list states with explicit copy props", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(
          SettingsSection,
          { title: "通知设置" },
          createElement(
            Card,
            { size: "sm" },
            createElement(CardHeader, null, createElement(CardTitle, null, "提醒")),
            createElement(
              CardContent,
              null,
              createElement(Button, { variant: "outline" }, "保存"),
              createElement(Badge, { variant: "secondary" }, "已启用"),
              createElement(Spinner, { label: "加载中" })
            )
          )
        ),
        createElement(EmptyState, {
          title: "暂无课程",
          description: "切换学期查看其他记录",
        }),
        createElement(LoadingCards, { count: 2 }),
        createElement(ValidatingList, { validating: true }, createElement("span", null, "列表"))
      )
    )

    expect(html).toContain("通知设置")
    expect(html).toContain("暂无课程")
    expect(html).toContain("切换学期查看其他记录")
    expect(html).toContain('aria-label="加载中"')
    expect(html).toContain("opacity-50")
  })

  it("renders filter, breadcrumb, pagination, and sidebar labels strictly from props", () => {
    const html = renderToStaticMarkup(
      createElement(
        SidebarProvider,
        { cookieName: null },
        createElement(
          Sidebar,
          { collapsible: "none" },
          createElement(SidebarContent, null, "导航栏")
        ),
        createElement(SidebarTrigger, { toggleLabel: "切换侧栏" }),
        createElement(FilterChips, {
          items: [
            { value: "2026-1", label: "2026秋" },
            { value: "2026-2", label: "2027春" },
          ],
          value: "2026-1",
          onChange: () => {},
        }),
        createElement(FilterOptionList, {
          items: [{ value: "all", label: "全部" }],
          value: "all",
          onChange: () => {},
        }),
        createElement(
          Breadcrumb,
          { label: "面包屑" },
          createElement(
            BreadcrumbList,
            null,
            createElement(BreadcrumbItem, null, createElement(BreadcrumbPage, null, "成绩")),
            createElement(
              BreadcrumbItem,
              null,
              createElement(BreadcrumbEllipsis, { moreLabel: "更多" })
            )
          )
        ),
        createElement(
          Pagination,
          { label: "分页" },
          createElement(
            PaginationContent,
            null,
            createElement(
              PaginationItem,
              null,
              createElement(PaginationPrevious, {
                href: "#prev",
                text: "上一页",
                ariaLabel: "前往上一页",
              })
            ),
            createElement(
              PaginationItem,
              null,
              createElement(PaginationEllipsis, { moreLabel: "更多页" })
            ),
            createElement(
              PaginationItem,
              null,
              createElement(PaginationNext, {
                href: "#next",
                text: "下一页",
                ariaLabel: "前往下一页",
              })
            )
          )
        )
      )
    )

    expect(html).toContain("切换侧栏")
    expect(html).toContain("2026秋")
    expect(html).toContain('aria-label="面包屑"')
    expect(html).toContain('aria-label="分页"')
    expect(html).toContain("上一页")
    expect(html).toContain("下一页")
    expect(html).toContain("更多页")
  })
})
