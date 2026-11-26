import { defineStore, type StoreInstance } from "@orahako/sdk"

export interface EvaluationViewState {
  readonly batchSelectOpen: boolean
  readonly selectedTaskIds: ReadonlySet<string>
  readonly batchTextAnswer: string
}

export const evaluationViewStore = defineStore({
  init: (): EvaluationViewState => ({
    batchSelectOpen: false,
    selectedTaskIds: new Set(),
    batchTextAnswer: "",
  }),
  actions: {
    openBatchSelect(ctx) {
      ctx.set((state) => ({
        ...state,
        batchSelectOpen: true,
        selectedTaskIds: new Set(),
        batchTextAnswer: "",
      }))
    },
    setBatchSelectOpen(ctx, batchSelectOpen: boolean) {
      ctx.set((state) => ({ ...state, batchSelectOpen }))
    },
    toggleTaskSelection(ctx, taskId: string) {
      ctx.set((state) => {
        const selectedTaskIds = new Set(state.selectedTaskIds)
        if (selectedTaskIds.has(taskId)) selectedTaskIds.delete(taskId)
        else selectedTaskIds.add(taskId)
        return { ...state, selectedTaskIds }
      })
    },
    selectTasks(ctx, taskIds: readonly string[]) {
      ctx.set((state) => ({ ...state, selectedTaskIds: new Set(taskIds) }))
    },
    setBatchTextAnswer(ctx, batchTextAnswer: string) {
      ctx.set((state) => ({ ...state, batchTextAnswer }))
    },
  },
})

export type EvaluationViewStoreInstance = StoreInstance<
  EvaluationViewState,
  typeof evaluationViewStore.spec.actions
>
