import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "settings.notifications.appReminders": { kind: "list"; owner: Record<string, never> }
    "shell.header.actions": { kind: "list"; owner: Record<string, never> }
  }
}
