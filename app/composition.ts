/**
 * Explicit application composition root.
 *
 * This module is the only application entry that references the official
 * plugins. Selecting another application means replacing the module targets
 * below (identity, provider tree, landing behaviour); kernel layouts, route
 * hosts and shared components stay untouched.
 */
export { appIdentity } from "./composition/identity"
export { AppComposition } from "./composition/providers"
export { AppHome } from "./composition/home"
