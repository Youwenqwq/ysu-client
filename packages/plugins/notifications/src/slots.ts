import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "settings.notifications.content": { kind: "list"; owner: Record<string, never> }
    "settings.notifications.reminders": { kind: "list"; owner: Record<string, never> }
    "settings.notifications.appReminders": { kind: "list"; owner: Record<string, never> }
    "debug.panels": { kind: "list"; owner: Record<string, never> }
  }
}
