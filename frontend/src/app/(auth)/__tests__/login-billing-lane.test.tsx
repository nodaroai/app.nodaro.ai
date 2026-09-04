/**
 * B2 — the billing account's sign-in lane, and the trap under it.
 *
 * On an SSO-only deployment the account that holds the deployment's credits is
 * a local password account, and this page cannot render a form for it. The
 * spec's sketch was to add "email" to `codeDefaultAuthMethods` BEFORE
 * `surfaceAuthMethods` narrows — but `surfaceAuthMethods` is an INTERSECTION
 * (`surface-selectors.ts:81`), so on a profile of `["sso"]` the added method is
 * intersected straight back out. That instruction is a silent no-op, and the
 * first assertion below is there to keep anyone from "restoring" it.
 *
 * The override therefore has to survive the narrowing, so the page applies it
 * AFTER, on an explicit `/login?billing=1` that nothing links to. Revealing the
 * form grants nothing — the server's H6 gate admits exactly one uuid — but two
 * properties still have to hold, and both are asserted here:
 *
 *   - the hatch does NOT re-open self-registration (no "create an account"
 *     invite on an SSO-only instance), and
 *   - it is inert wherever the deployment does not narrow auth at all, so
 *     `?billing=1` on Nodaro Cloud renders exactly today's page (R2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

// SAI is EDITION=cloud — the edition on which `codeDefaultAuthMethods` omits
// "email" entirely. Using anything else would test the easy case.
vi.mock("@/lib/edition", () => ({ isCloud: () => true }))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ signInWithGoogle: vi.fn(), signInWithEmail: vi.fn() }),
}))

import LoginPage from "../login/page"
import { surfaceAuthMethods } from "@/lib/surface-selectors"
import type { AuthMethod } from "@/lib/surface-profile"

type RuntimeWindow = Window & {
  __NODARO_RUNTIME__?: { surface?: { auth?: { methods?: AuthMethod[]; ssoLabel?: string } } }
}

function setProfileAuthMethods(methods: AuthMethod[] | null): void {
  const w = window as RuntimeWindow
  if (methods === null) delete w.__NODARO_RUNTIME__
  else w.__NODARO_RUNTIME__ = { surface: { auth: { methods, ssoLabel: "SAI" } } }
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/v1/sso/providers"))
        return {
          ok: true,
          json: async () => ({ providers: [{ id: "librechat", label: "SAI", kind: "assertion" }] }),
        } as Response
      return { ok: false, json: async () => ({}) } as Response
    }),
  )
})
afterEach(() => {
  setProfileAuthMethods(null)
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LoginPage />
    </MemoryRouter>,
  )
}

const passwordField = (c: HTMLElement) => c.querySelector('input[type="password"]')

describe("the narrowing trap the spec's literal wording walks into", () => {
  it("adding \"email\" to the CODE DEFAULT is intersected away by an sso-only profile", () => {
    setProfileAuthMethods(["sso"])
    expect(surfaceAuthMethods(["email", "sso"])).toEqual(["sso"])
    expect(surfaceAuthMethods(["email", "sso"])).not.toContain("email")
  })
})

describe("/login on an sso-only deployment", () => {
  it("renders NO password field without the flag", async () => {
    setProfileAuthMethods(["sso"])
    const { container } = renderAt("/login")
    await waitFor(() => expect(screen.getByText(/SAI/)).toBeTruthy())
    expect(passwordField(container)).toBeNull()
  })

  it("?billing=1 reveals the password form", async () => {
    setProfileAuthMethods(["sso"])
    const { container } = renderAt("/login?billing=1")
    await waitFor(() => expect(passwordField(container)).not.toBeNull())
  })

  it("?billing=1 does NOT re-open self-registration", async () => {
    setProfileAuthMethods(["sso"])
    const { container } = renderAt("/login?billing=1")
    await waitFor(() => expect(passwordField(container)).not.toBeNull())
    // The "New here? Create an account" invite stays keyed on the NARROWED
    // method. An sso-only instance must not advertise signUp against its
    // publicly reachable GoTrue because the billing account asked for a
    // password box.
    expect(container.querySelector('a[href="/signup"]')).toBeNull()
  })
})

describe("mainline is untouched (R2)", () => {
  it("a deployment narrowed to something OTHER than sso gets no hatch", async () => {
    // The hatch exists because H6 refuses the payer, and H6 only runs when
    // `surfaceSsoOnly()` is true — `methods.length > 0 && every(m => m ===
    // "sso")`. A google-narrowed deployment refuses nobody, so it needs no
    // password box, and the page must not grow one.
    setProfileAuthMethods(["google"])
    const { container } = renderAt("/login?billing=1")
    await waitFor(() => expect(screen.getByText(/Google/i)).toBeTruthy())
    expect(passwordField(container)).toBeNull()
  })

  it("with no auth narrowing at all, ?billing=1 renders exactly today's page", async () => {
    setProfileAuthMethods(null)
    const { container } = renderAt("/login?billing=1")
    await waitFor(() => expect(screen.getByText(/SAI|Single sign-on/)).toBeTruthy())
    // Cloud's code default carries no "email", the profile narrows nothing, and
    // the hatch is gated on the profile narrowing — so no form appears.
    expect(passwordField(container)).toBeNull()
  })
})
