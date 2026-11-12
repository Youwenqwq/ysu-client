/**
 * Host-facing re-export of the public provider contract.
 *
 * Provider domain types now live in the plugin SDK
 * (`@ysu/plugin-sdk/academic`) so plugins can implement `AcademicProvider`
 * without importing host-internal module paths.
 */
export * from "@ysu/plugin-sdk/academic"
export * from "@ysu/plugin-sdk/provider-school"
