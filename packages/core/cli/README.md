# `@orahako/cli`

Standalone plugin packer and CLI for Orahako API v1 plugins.

## Usage

```bash
pnpm add -D @orahako/cli @orahako/sdk @orahako/ui-primitives
pnpm exec orahako pack <plugin-directory> [output.zip]
```

From the host repository root, use `pnpm plugin pack <plugin-directory> [output.zip]`.

The packer validates `manifest.json`, bundles ESM with esbuild (externalizing
exactly `PLATFORM_MODULES`), compiles plugin Tailwind utilities against the
Orahako host design tokens, validates the resulting ZIP, and prints its path,
byte size, and SHA-256. See the [SDK guide](../sdk/README.md) for manifest fields
and publishing details.
