import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.banner": { kind: "list"; owner: Record<string, never> }
    "shell.activity": { kind: "list"; owner: Record<string, never> }
    "profile.header": { kind: "single"; owner: Record<string, never> }
    "profile.accountActions": { kind: "list"; owner: Record<string, never> }
    "settings.account": { kind: "list"; owner: Record<string, never> }
  }
}
