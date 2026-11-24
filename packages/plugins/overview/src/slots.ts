import type { ReactNode } from "react"
import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "overview.widget": { kind: "keyed"; owner: { readonly children?: ReactNode } }
    "settings.startupOptions": { kind: "list"; owner: Record<string, never> }
  }
}
