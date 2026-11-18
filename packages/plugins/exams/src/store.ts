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
