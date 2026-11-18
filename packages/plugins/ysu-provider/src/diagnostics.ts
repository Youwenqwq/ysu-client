import type {
  CookieJar,
  ProviderDiagnosticCookie,
  ProviderDiagnostics,
} from "@orahako/academic-sdk"
import type { CASProtocol } from "./protocol/cas"
import type { JWMobileProtocol } from "./protocol/jwmobile"
import type { JWXTProtocol } from "./protocol/jwxt"

async function getJarCookies(getJar: () => CookieJar): Promise<ProviderDiagnosticCookie[]> {
  return [...(await getJar().getAllCookies())]
}

export function createYsuDiagnostics(
  cas: Pick<CASProtocol, "getJar" | "isAuthenticated">,
  jwxt: Pick<JWXTProtocol, "getJar" | "resetJWXT">,
  mobile: Pick<JWMobileProtocol, "ensureMobileAuthorized">
): ProviderDiagnostics {
  return {
    labels: {
      authSystem: "CAS",
      academicSystem: "JWXT",
      authToken: "CASTGC",
      authCookies: "CAS Jar",
      academicCookies: "JWXT Jar",
      authSession: "CAS Auth",
      academicSession: "JWXT Session",
      mobileAuth: "Mobile Auth",
    },
    getAuthCookies: () => getJarCookies(() => cas.getJar()),
    getAcademicCookies: () => getJarCookies(() => jwxt.getJar()),
    checkAuth: () => cas.isAuthenticated(),
    resetAcademicSession: () => jwxt.resetJWXT(),
    ensureMobileAuthorized: () => mobile.ensureMobileAuthorized(),
  }
}
