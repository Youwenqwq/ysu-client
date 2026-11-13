/**
 * Host-facing re-export of the public provider contract.
 *
 * Provider domain types now live in the plugin SDK
 * (`@orahako/plugin-sdk/academic`) so plugins can implement `AcademicProvider`
 * without importing host-internal module paths.
 */
export * from "@orahako/plugin-sdk/academic"
export * from "@orahako/plugin-sdk/provider-school"
