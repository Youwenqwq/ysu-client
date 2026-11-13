import { describe, expect, it } from "vitest"
import { useAuthStore } from "./auth"

describe("auth school credentials", () => {
  it("preserves each school's credential across active-school switches", () => {
    const auth = useAuthStore.getState()
    auth.activateSchool("ysu")
    useAuthStore.getState().clearCredential("ysu")
    useAuthStore.getState().clearCredential("zmu")
    useAuthStore.getState().setCredential("ysu-token", "ysu-user", "ysu")
    useAuthStore.getState().activateSchool("zmu")
    expect(useAuthStore.getState().credential).toBeNull()

    useAuthStore.getState().setCredential("zmu-token", "zmu-user", "zmu")
    useAuthStore.getState().activateSchool("ysu")
    expect(useAuthStore.getState()).toMatchObject({
      credential: "ysu-token",
      username: "ysu-user",
      isAuthenticated: true,
    })
    useAuthStore.getState().clearCredential("zmu")
    expect(useAuthStore.getState().credential).toBe("ysu-token")
    useAuthStore.getState().activateSchool("zmu")
    expect(useAuthStore.getState().isAuthenticated).toBe(false)

    useAuthStore.getState().activateSchool("ysu")
    useAuthStore.getState().clearCredential("ysu")
  })
})
