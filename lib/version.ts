/** App metadata — version & build are injected at build time from package.json + git. */

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "dev"
export const APP_COPYRIGHT = `© ${new Date().getFullYear()} Youwenqwq`
export const APP_LICENSE = "GPL-3.0"
export const APP_REPO = "https://github.com/Youwenqwq/orahako"
