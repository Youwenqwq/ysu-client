import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "overview.widget": { kind: "keyed"; owner: Record<string, never> }
    "settings.startupOptions": { kind: "list"; owner: Record<string, never> }
  }
}
