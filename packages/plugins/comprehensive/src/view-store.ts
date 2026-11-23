import { defineStore, type StoreInstance } from "@orahako/sdk"

interface ComprehensiveViewState {
  readonly tab: string
  readonly filterDrawerOpen: boolean
}

export const comprehensiveViewStore = defineStore({
  init: (): ComprehensiveViewState => ({ tab: "result", filterDrawerOpen: false }),
  actions: {
    setTab(ctx, tab: string) {
      ctx.set((state) => ({ ...state, tab }))
    },
    setFilterDrawerOpen(ctx, filterDrawerOpen: boolean) {
      ctx.set((state) => ({ ...state, filterDrawerOpen }))
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type ComprehensiveViewStoreInstance = StoreInstance<
  ComprehensiveViewState,
  typeof comprehensiveViewStore.spec.actions
>
