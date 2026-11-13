/**
 * @orahako/plugin-ui — public React UI kit / app hooks for plugins.
 *
 * The root entry intentionally does NOT aggregate all implementations: a
 * barrel that pulls in host stores/components would create evaluation cycles
 * with `lib/plugins/host.ts` (which imports plugin-ui submodules and the
 * official plugin registry). Import what you need from a specific submodule:
 *
 * - `@orahako/plugin-ui/components`  shadcn/ui + shared presentational components
 * - `@orahako/plugin-ui/hooks`       React hooks (i18n, provider data, media)
 * - `@orahako/plugin-ui/stores`      host Zustand stores + storage adapters
 * - `@orahako/plugin-ui/academic`    schedule/term/exam utilities
 * - `@orahako/plugin-ui/platform`    native bridge, navigation, widgets, version
 * - `@orahako/plugin-ui/plugin`      plugin-host hooks + navigation resolvers
 * - `@orahako/plugin-ui/shell`       host-aware shell components (provider ctx)
 * - `@orahako/plugin-ui/assets`      host static image assets
 *
 * All exports are re-exports of existing host modules; no implementations
 * are copied.
 */
export {}
