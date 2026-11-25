export interface KernelTelemetryService {
  readonly endpoint: string | null
  track(
    payload: Readonly<Record<string, unknown>>,
    options: { readonly enabled: boolean }
  ): Promise<{
    readonly tracked: boolean
    readonly reason: "sent" | "disabled"
    readonly date: string | null
  }>
}

declare module "@cordisjs/core" {
  interface Context {
    kernelTelemetry: KernelTelemetryService
  }
}
