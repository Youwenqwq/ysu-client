import type { ProviderDiagnosticCookie, ProviderDiagnostics } from "@orahako/plugin-sdk/academic"
import type { CookieJar } from "@orahako/plugin-sdk"
import type { CASProtocol } from "./protocol/cas"
import type { JWXTProtocol } from "./protocol/jwxt"
import type { JWMobileProtocol } from "./protocol/jwmobile"

async function getJarCookies(getJar: () => CookieJar): Promise<ProviderDiagnosticCookie[]> {
  return [...(await getJar().getAllCookies())]
}

export function createYsuDiagnostics(
  cas: CASProtocol,
  jwxt: JWXTProtocol,
  mobile: JWMobileProtocol
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
    ensureMobileAuthorized: (verify?: boolean) => mobile.ensureMobileAuthorized(verify),
  }
}
