import {
  createDefaultOverviewLayout,
  normalizeOverviewLayout,
  type OverviewLayout,
} from "@orahako/academic-kit"
import { defineDictionary, defineStore, type StoreInstance } from "@orahako/sdk"

export const overviewDictionary = defineDictionary({
  zh: {
    pageTitle: "总览",
    startupOption: "总览",
    settingsTitle: "设置",
    layout: {
      customize: "自定义总览",
      settingsDescription: "选择显示内容与排列顺序，移动端摘要每行最多三列。",
      editDescription: "拖动手柄或使用上下按钮调整同一区域的顺序，保存后生效。",
      save: "保存",
      cancel: "取消",
      reset: "恢复默认",
      addWidgets: "添加组件",
      add: "添加",
      done: "完成",
      libraryDescription: "选择要显示的组件，添加后可调整顺序。",
      preview: "组件预览",
      summary: "摘要信息",
      content: "详细内容",
      profile: "个人信息",
      profileDescription: "在摘要上方显示头像、姓名和学籍信息。",
      profileShown: "个人信息已显示",
      profileHidden: "个人信息已隐藏",
      drag: "拖动{title}",
      moveUp: "上移{title}",
      moveDown: "下移{title}",
      hide: "隐藏{title}",
      addWidget: "添加{title}",
      regionEmpty: "此区域暂无组件",
      regionEmptyDescription: "使用“添加组件”选择要显示的内容。",
      allAdded: "此区域的组件均已添加。",
      empty: "总览暂无显示内容",
      emptyDescription: "前往设置添加总览组件，或恢复默认布局。",
      loading: "正在加载总览布局",
      keyboardInstructions:
        "按空格键拿起组件，使用方向键在当前区域移动，再按空格键放下，按 Escape 取消。",
      dragStart: "已拿起{title}。",
      dragOver: "正在将{title}移至{target}的位置。",
      dragEnd: "已放下{title}。",
      dragCancel: "已取消移动{title}。",
    },
    widgets: {
      profile: {
        title: "个人信息",
        description: "查看姓名、学号、学院与专业概览。",
        fallbackName: "学生信息",
      },
      weekSummary: {
        title: "学期信息",
        description: "查看当前教学周、星期与学期。",
        termLabel: "学期信息",
        currentWeek: "第 {week} 周",
        weekday1: "星期一",
        weekday2: "星期二",
        weekday3: "星期三",
        weekday4: "星期四",
        weekday5: "星期五",
        weekday6: "星期六",
        weekday7: "星期日",
      },
    },
    queryState: {
      loading: "正在加载",
      failed: "暂时无法加载此组件",
      stale: "暂未更新，正在显示上次数据",
      staleShort: "未更新",
      unavailableShort: "暂不可用",
      unsupported: "当前学校暂不支持此组件",
      sessionExpired: "登录已过期，请重新登录",
      retry: "重试",
    },
  },
  en: {
    pageTitle: "Overview",
    startupOption: "Overview",
    settingsTitle: "Settings",
    layout: {
      customize: "Customize overview",
      settingsDescription:
        "Choose widgets and their order. Mobile summaries use up to three columns.",
      editDescription:
        "Drag a handle or use the arrow buttons to reorder within each region. Save to apply.",
      save: "Save",
      cancel: "Cancel",
      reset: "Reset to default",
      addWidgets: "Add widgets",
      add: "Add",
      done: "Done",
      libraryDescription: "Choose which widgets to show, then arrange them in your overview.",
      preview: "Widget preview",
      summary: "Summary",
      content: "Details",
      profile: "Profile",
      profileDescription: "Show your avatar, name and student information above the summary.",
      profileShown: "Profile shown",
      profileHidden: "Profile hidden",
      drag: "Drag {title}",
      moveUp: "Move {title} up",
      moveDown: "Move {title} down",
      hide: "Hide {title}",
      addWidget: "Add {title}",
      regionEmpty: "No widgets in this region",
      regionEmptyDescription: "Choose what to display using Add widgets.",
      allAdded: "All widgets in this region have been added.",
      empty: "Nothing to display",
      emptyDescription: "Add overview widgets in Settings, or restore the default layout.",
      loading: "Loading overview layout",
      keyboardInstructions:
        "Press Space to pick up a widget. Use the arrow keys to move within its region. Press Space to drop it, or Escape to cancel.",
      dragStart: "Picked up {title}.",
      dragOver: "Moving {title} to the position of {target}.",
      dragEnd: "Dropped {title}.",
      dragCancel: "Cancelled moving {title}.",
    },
    widgets: {
      profile: {
        title: "Profile",
        description: "View your name, student ID, department, and major.",
        fallbackName: "Student Info",
      },
      weekSummary: {
        title: "Current term",
        description: "See the teaching week, weekday and term.",
        termLabel: "Current term",
        currentWeek: "Week {week}",
        weekday1: "Monday",
        weekday2: "Tuesday",
        weekday3: "Wednesday",
        weekday4: "Thursday",
        weekday5: "Friday",
        weekday6: "Saturday",
        weekday7: "Sunday",
      },
    },
    queryState: {
      loading: "Loading",
      failed: "Unable to load this widget",
      stale: "Not updated; showing previous data",
      staleShort: "Not updated",
      unavailableShort: "Unavailable",
      unsupported: "This widget is unavailable for your school",
      sessionExpired: "Login expired, please sign in again",
      retry: "Retry",
    },
  },
})

export type OverviewDictionary = typeof overviewDictionary

export interface OverviewLayoutState {
  readonly overviewLayout: OverviewLayout
}

export const overviewLayoutStore = defineStore({
  init: (): OverviewLayoutState => ({
    overviewLayout: createDefaultOverviewLayout(),
  }),
  persist: {
    key: "overview-layout",
    mode: "local",
    version: 1,
    migrate: (persisted) => {
      if (typeof persisted === "object" && persisted !== null && "overviewLayout" in persisted) {
        return {
          overviewLayout: normalizeOverviewLayout(persisted.overviewLayout),
        }
      }
      return {
        overviewLayout: normalizeOverviewLayout(persisted),
      }
    },
  },
  actions: {
    setOverviewLayout(ctx, nextLayout: OverviewLayout) {
      ctx.set({ overviewLayout: nextLayout })
    },
    resetLayout(ctx) {
      ctx.set({ overviewLayout: createDefaultOverviewLayout() })
    },
  },
})

export type OverviewLayoutStoreInstance = StoreInstance<
  OverviewLayoutState,
  typeof overviewLayoutStore.spec.actions
>
