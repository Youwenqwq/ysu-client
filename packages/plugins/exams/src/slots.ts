import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "settings.widgets": { kind: "list"; owner: Record<string, never> }
    "settings.notifications.content": { kind: "list"; owner: Record<string, never> }
    "shell.header.actions": { kind: "list"; owner: Record<string, never> }
  }
}
