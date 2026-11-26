import { AppComposition } from "./composition/providers"

/** All application destinations are resolved by the client plugin router. */
export default function HomePage() {
  return <AppComposition />
}
