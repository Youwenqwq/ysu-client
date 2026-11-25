/**
 * Academic session cookie facade. The single cookie jar and redirect
 * implementation lives in `@orahako/sdk`; this module preserves the stable
 * academic-runtime export names used by sessions and provider tests.
 */
export {
  MAX_COOKIE_REDIRECTS,
  SimpleCookieJar,
  domainMatches,
  extractSetCookies,
  fetchWithCookieJar,
  headerSingle,
  pathMatches,
  secureMatches,
  splitSetCookie,
} from "@orahako/sdk"
