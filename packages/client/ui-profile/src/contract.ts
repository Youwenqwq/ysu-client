import type { ObservableSource } from "@orahako/sdk"

export interface PluginProfileService {
  readonly avatarUrl: ObservableSource<string | null>
}

declare module "@cordisjs/core" {
  interface Context {
    profile: PluginProfileService
  }
}
