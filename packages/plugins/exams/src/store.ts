import { defineStore, type StoreInstance } from "@orahako/sdk"

export interface ExamsSettingsState {
  readonly notifyExams: boolean
}

export const examsSettingsStore = defineStore({
  init: (): ExamsSettingsState => ({
    notifyExams: true,
  }),
  persist: {
    key: "exams-settings",
    mode: "local",
    version: 1,
  },
  actions: {
    setNotifyExams(ctx, notifyExams: boolean) {
      ctx.set((prev) => (prev.notifyExams === notifyExams ? prev : { ...prev, notifyExams }))
    },
    toggleNotifyExams(ctx) {
      ctx.set((prev) => ({ ...prev, notifyExams: !prev.notifyExams }))
    },
  },
})

export type ExamsSettingsStoreInstance = StoreInstance<
  ExamsSettingsState,
  typeof examsSettingsStore.spec.actions
>

export const examsViewStore = defineStore({
  init: () => ({ filterDrawerOpen: false }),
  actions: {
    setFilterDrawerOpen(ctx, filterDrawerOpen: boolean) {
      ctx.set((state) =>
        state.filterDrawerOpen === filterDrawerOpen ? state : { filterDrawerOpen }
      )
    },
  },
})

export type ExamsViewStoreInstance = StoreInstance<
  { readonly filterDrawerOpen: boolean },
  typeof examsViewStore.spec.actions
>
