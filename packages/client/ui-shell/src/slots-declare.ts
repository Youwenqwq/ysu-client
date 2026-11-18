import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.gate": { kind: "chain"; owner: Record<string, never> }
    "shell.banner": { kind: "list"; owner: Record<string, never> }
    "shell.activity": { kind: "list"; owner: Record<string, never> }
    "shell.header.actions": { kind: "list"; owner: Record<string, never> }
    "shell.sidebar.footer": { kind: "list"; owner: Record<string, never> }
    "shell.overlay": { kind: "list"; owner: Record<string, never> }
    "settings.appearance": { kind: "list"; owner: Record<string, never> }
  }
}

declare module "@cordisjs/core" {
  interface Events {
    "shell/landing-preference"(route: string): void
  }
}
