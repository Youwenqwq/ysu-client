import type { AnyDefinedPlugin } from "@orahako/sdk"
import { notificationRegistryRuntimePlugin } from "./notifications"
import { providerRegistryRuntimePlugin } from "./provider-registry"
import { providerRuntimePlugin } from "./provider-runtime"
import { providerSupportRuntimePlugin } from "./provider-support"
import { queryRuntimePlugin } from "./query"
import { sessionRuntimePlugin } from "./session"

export * from "./cookie-jar"
export * from "./provider-registry"
export * from "./session"
export * from "./provider-runtime"
export * from "./provider-support"
export * from "./query"
export * from "./notifications"

export const academicRuntimePlugins = [
  providerRegistryRuntimePlugin,
  sessionRuntimePlugin,
  providerRuntimePlugin,
  providerSupportRuntimePlugin,
  queryRuntimePlugin,
  notificationRegistryRuntimePlugin,
] as const satisfies readonly AnyDefinedPlugin[]
