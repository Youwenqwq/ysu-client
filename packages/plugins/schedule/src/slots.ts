import type { ScheduleEntryDetailOwner } from "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "settings.startupOptions": { kind: "list"; owner: Record<string, never> }
    "settings.widgets": { kind: "list"; owner: Record<string, never> }
    "settings.widgets.add": { kind: "list"; owner: Record<string, never> }
    "settings.notifications.reminders": { kind: "list"; owner: Record<string, never> }
    "shell.header.actions": { kind: "list"; owner: Record<string, never> }
    "schedule.toolbar.actions": { kind: "list"; owner: Record<string, never> }
    "schedule.entry.detail": { kind: "list"; owner: ScheduleEntryDetailOwner }
  }
}
