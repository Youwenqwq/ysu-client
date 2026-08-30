import type { ProviderDiagnosticCookie, ProviderDiagnostics } from "../types"
import { getJar as getCasJar, isAuthenticated as checkCASAuth } from "./protocol/cas"
import { getJar as getJwxtJar, resetJWXT } from "./protocol/jwxt"
import { casUrls } from "@/lib/server-config"
import { ensureMobileAuthorized } from "./protocol/jwmobile"

async function getJarCookies(
  getJar: () => {
    getAllCookies(): Promise<readonly ProviderDiagnosticCookie[]>
  }
): Promise<ProviderDiagnosticCookie[]> {
  return [...(await getJar().getAllCookies())]
}

export const ysuDiagnostics: ProviderDiagnostics = {
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
  getAuthCookies: () => getJarCookies(getCasJar),
  getAcademicCookies: () => getJarCookies(getJwxtJar),
  getAuthCookieUrl: () => casUrls.authLogin,
  checkAuth: checkCASAuth,
  resetAcademicSession: resetJWXT,
  ensureMobileAuthorized,
}
