import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "settings.notifications.content": { kind: "list"; owner: Record<string, never> }
  }
}
