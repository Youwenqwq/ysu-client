/**
 * @ysu/plugin-ui — public React UI kit / app hooks for plugins.
 *
 * The root entry intentionally does NOT aggregate all implementations: a
 * barrel that pulls in host stores/components would create evaluation cycles
 * with `lib/plugins/host.ts` (which imports plugin-ui submodules and the
 * official plugin registry). Import what you need from a specific submodule:
 *
 * - `@ysu/plugin-ui/components`  shadcn/ui + shared presentational components
 * - `@ysu/plugin-ui/hooks`       React hooks (i18n, provider data, media)
 * - `@ysu/plugin-ui/stores`      host Zustand stores + storage adapters
 * - `@ysu/plugin-ui/academic`    schedule/term/exam utilities
 * - `@ysu/plugin-ui/platform`    native bridge, navigation, widgets, version
 * - `@ysu/plugin-ui/plugin`      plugin-host hooks + navigation resolvers
 * - `@ysu/plugin-ui/shell`       host-aware shell components (provider ctx)
 * - `@ysu/plugin-ui/assets`      host static image assets
 *
 * All exports are re-exports of existing host modules; no implementations
 * are copied.
 */
export {}
