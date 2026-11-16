import type { ProviderRuntimeSnapshot } from "./provider-runtime"
import type { SessionSnapshot } from "./session"
import type { ProviderQueryIdentity } from "./query"

declare module "@cordisjs/core" {
  interface Events {
    "session/changed"(snapshot: SessionSnapshot): void
    "session/expired"(snapshot: SessionSnapshot): void
    "provider/changed"(snapshot: ProviderRuntimeSnapshot): void
    "provider/ready"(snapshot: ProviderRuntimeSnapshot): void
    "query/invalidate"(identity: Partial<ProviderQueryIdentity> | undefined): void
  }
}
