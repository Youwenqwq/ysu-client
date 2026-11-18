import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.sidebar.footer": { kind: "list"; owner: Record<string, never> }
    "settings.appearance": { kind: "list"; owner: Record<string, never> }
    "profile.header": { kind: "single"; owner: Record<string, never> }
    "profile.accountActions": { kind: "list"; owner: Record<string, never> }
    "about.extra": { kind: "list"; owner: Record<string, never> }
    "debug.panels": { kind: "list"; owner: Record<string, never> }
  }
}
