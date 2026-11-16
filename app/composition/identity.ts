import { officialAppIdentity } from "@/plugins/official/app-config"

/**
 * Static application identity for the Next.js metadata and web app manifest.
 * Kept server-safe in its own module so `app/layout.tsx` can read it without
 * pulling the executable composition (and its client modules) into the server
 * bundle.
 */
export const appIdentity = officialAppIdentity
