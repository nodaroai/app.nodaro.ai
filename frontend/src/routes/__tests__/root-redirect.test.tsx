import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import RootRedirect from "../root-redirect"

/**
 * The site's root address opens the projects. It is also where the auth server
 * returns a sign-in it could not match to a request (an expired one, or one
 * replayed by the browser's Back button), with the error on the address. That
 * error used to be dropped on the way to the projects, so a signed-out person
 * was shown the sign-in form again with no reason.
 */

function Landed() {
  const { pathname, search } = useLocation()
  return <p>{`landed ${pathname}${search}`}</p>
}

function openRootAt(address: string) {
  return render(
    <MemoryRouter initialEntries={[address]}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe("the root address", () => {
  it("opens the projects", () => {
    openRootAt("/")
    expect(screen.getByText("landed /projects")).toBeInTheDocument()
  })

  it("opens the projects whatever else the address carries", () => {
    openRootAt("/?utm_source=newsletter")
    expect(screen.getByText("landed /projects")).toBeInTheDocument()
  })

  it("sends a failed sign-in to the sign-in page's notice (query)", () => {
    openRootAt("/?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+not+found+or+expired")
    expect(screen.getByText("landed /login?failed=1")).toBeInTheDocument()
  })

  it("sends a failed sign-in to the sign-in page's notice (fragment)", () => {
    openRootAt("/#error=server_error&error_code=unexpected_failure")
    expect(screen.getByText("landed /login?failed=1")).toBeInTheDocument()
  })

  it("sends a blocked account to its own notice", () => {
    openRootAt("/?error=access_denied&error_code=user_banned")
    expect(screen.getByText("landed /login?blocked=1")).toBeInTheDocument()
  })
})
