import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import React from "react"

const signInWithPassword = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null } })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword,
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: vi.fn() }) }) }),
  }),
}))

import { useAuth } from "../use-auth"

const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(MemoryRouter, null, children)

/**
 * The login page tells a blocked account (`user_banned`) from a wrong password
 * by the AuthError's `code`. Re-throwing a copy of the message dropped it, and
 * a blocked person read "User is banned" in English instead of the notice.
 */
describe("useAuth().signInWithEmail", () => {
  it("throws GoTrue's error itself, code included", async () => {
    const goTrueError = Object.assign(new Error("User is banned"), { code: "user_banned", status: 400 })
    signInWithPassword.mockResolvedValue({ data: {}, error: goTrueError })
    const { result } = renderHook(() => useAuth(), { wrapper })
    const thrown = await result.current.signInWithEmail("a@x.test", "pw").catch((e: unknown) => e)
    expect(thrown).toBe(goTrueError)
    expect((thrown as { code?: string }).code).toBe("user_banned")
  })

  it("resolves when the sign-in succeeds", async () => {
    signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null })
    const { result } = renderHook(() => useAuth(), { wrapper })
    await expect(result.current.signInWithEmail("a@x.test", "pw")).resolves.toBeUndefined()
  })
})
