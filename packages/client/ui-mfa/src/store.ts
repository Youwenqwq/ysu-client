import { defineStore, type StoreInstance } from "@orahako/sdk"
import type {
  MfaChallenge,
  MfaMethod,
  MfaRequest,
  MfaResult,
  MfaService,
} from "@orahako/academic-sdk"

export type MfaCancelReason = "cancelled" | "superseded" | "disposed"

export class MfaCancelledError extends Error {
  readonly reason: MfaCancelReason

  constructor(reason: MfaCancelReason, message?: string) {
    super(
      message ??
        (reason === "superseded"
          ? "MFA request superseded"
          : reason === "disposed"
            ? "MFA service disposed"
            : "MFA verification cancelled")
    )
    this.name = "MfaCancelledError"
    this.reason = reason
  }
}

export interface MfaPendingHandlers {
  readonly resolve: (result: MfaResult) => void
  readonly reject: (error: Error) => void
}

export interface MfaModalState {
  readonly open: boolean
  readonly requestId: number
  readonly username: string
  readonly method?: MfaMethod
  readonly methods?: readonly MfaMethod[]
  readonly challenge?: Partial<MfaChallenge>
  readonly pending: MfaPendingHandlers | null
}

export const mfaModalStore = defineStore({
  init: (): MfaModalState => ({
    open: false,
    requestId: 0,
    username: "",
    method: undefined,
    methods: undefined,
    challenge: undefined,
    pending: null,
  }),
  actions: {
    openRequest(ctx, request: MfaRequest, handlers: MfaPendingHandlers) {
      const previous = ctx.get()
      const superseded = previous.pending
      ctx.set({
        open: true,
        requestId: previous.requestId + 1,
        username: request.username,
        method: request.method,
        methods: request.methods ? [...request.methods] : undefined,
        challenge: request.challenge ? { ...request.challenge } : undefined,
        pending: handlers,
      })
      superseded?.reject(new MfaCancelledError("superseded"))
    },
    submitCode(ctx, payload: { method: string; methodCode: string; code: string }) {
      const current = ctx.get()
      const pending = current.pending
      ctx.set({
        ...current,
        open: false,
        pending: null,
      })
      pending?.resolve({
        type: "code",
        method: payload.method,
        methodCode: payload.methodCode,
        code: payload.code,
      })
    },
    completeWechat(ctx) {
      const current = ctx.get()
      const pending = current.pending
      ctx.set({
        ...current,
        open: false,
        pending: null,
      })
      pending?.resolve({ type: "wechat" })
    },
    cancel(ctx, reason: MfaCancelReason = "cancelled") {
      const current = ctx.get()
      const pending = current.pending
      ctx.set({
        ...current,
        open: false,
        pending: null,
      })
      pending?.reject(new MfaCancelledError(reason))
    },
  },
})

export type MfaModalStore = typeof mfaModalStore
export type MfaModalStoreInstance = ReturnType<MfaModalStore["create"]>

export interface ManagedMfaService extends MfaService {
  readonly store: MfaModalStoreInstance
  dispose(): void
}

export function createMfaService(
  existingStore?: StoreInstance<MfaModalState, MfaModalStore["spec"]["actions"]>
): ManagedMfaService {
  const store = existingStore ?? mfaModalStore.create()
  let disposed = false

  return {
    store,
    show(request: MfaRequest): Promise<MfaResult> {
      if (disposed) {
        return Promise.reject(new MfaCancelledError("disposed"))
      }
      return new Promise<MfaResult>((resolve, reject) => {
        store.actions.openRequest(request, { resolve, reject })
      })
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      store.actions.cancel("disposed")
      store.dispose()
    },
  }
}
