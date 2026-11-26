import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "settings.category.panel": { kind: "keyed"; owner: Record<string, never> }
    "settings.appearance": { kind: "list"; owner: Record<string, never> }
    "settings.startupOptions": { kind: "list"; owner: Record<string, never> }
    "settings.general": { kind: "list"; owner: Record<string, never> }
    "settings.account": { kind: "list"; owner: Record<string, never> }
    "debug.panels": { kind: "list"; owner: Record<string, never> }
  }
}
