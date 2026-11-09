import { afterEach, describe, expect, it, vi } from "vitest"
import { render, renderHook } from "@testing-library/react"
import type { ComponentType } from "react"

/**
 * The hosted header's product side as the pinned package ships it: what
 * `ee/shell/hosted-header.tsx` relies on, beyond the types the contract job
 * checks. Runs wherever the package is installed — the shared-header contract
 * job installs it and sets SHARED_HEADER_TESTS_REQUIRE_PACKAGE=1, under which a
 * missing package fails instead of skipping. Public CI has no package, so
 * there it skips.
 */

const env = vi.hoisted(() => ({
  // Built from fragments: a computed specifier keeps Vite from resolving it where it is absent.
  specifier: ["@nodaroai", "shell", "header"].join("/"),
  require: process.env.SHARED_HEADER_TESTS_REQUIRE_PACKAGE === "1",
}))

interface PackageHeader {
  readonly PAGE_IDS: readonly string[]
  readonly HEADER_TAG: string
  readonly HEADER_EVENTS: Readonly<Record<"navigate" | "failed", string>>
  readonly FALLBACK_REVEAL_MS: number
  readonly HeaderFallback: ComponentType
  readonly useHeaderNavigation: (navigate: (path: string) => void, isOwnRoute?: (path: string) => boolean) => void
  readonly onHeaderFailure: (onFailure: (reason: string) => void, afterMs?: number) => () => void
}

let pkg: PackageHeader | null = null
try {
  pkg = (await import(/* @vite-ignore */ env.specifier)) as PackageHeader
} catch (error) {
  if (env.require) throw error
}

afterEach(() => {
  vi.useRealTimers()
  document.documentElement.removeAttribute("data-nodaro-header")
})

describe.skipIf(!pkg)("the hosted header's product side, in the pinned package", () => {
  it("knows the two pages this app says it is on", () => {
    expect(pkg!.PAGE_IDS).toContain("flow")
    expect(pkg!.PAGE_IDS).toContain("flow-canvas")
  })

  it("reports a header that never defines itself, after the same wait as the frozen fallback", () => {
    vi.useFakeTimers()
    const failed = vi.fn()
    const stop = pkg!.onHeaderFailure(failed)
    vi.advanceTimersByTime(pkg!.FALLBACK_REVEAL_MS - 1)
    expect(failed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(failed).toHaveBeenCalledWith("undefined")
    stop()
  })

  it("reports the failure event at once, and a failure flagged before it was called", () => {
    const failed = vi.fn()
    const stop = pkg!.onHeaderFailure(failed)
    window.dispatchEvent(new CustomEvent(pkg!.HEADER_EVENTS.failed, { detail: { reason: "render" } }))
    expect(failed).toHaveBeenCalledWith("render")
    stop()

    document.documentElement.setAttribute("data-nodaro-header", "failed")
    const late = vi.fn()
    pkg!.onHeaderFailure(late)()
    expect(late).toHaveBeenCalledTimes(1)
  })

  it("sends a same-origin header link through the router, and leaves a link to another site alone", () => {
    const navigate = vi.fn()
    renderHook(() => pkg!.useHeaderNavigation(navigate))

    const own = new CustomEvent(pkg!.HEADER_EVENTS.navigate, {
      detail: { href: `${window.location.origin}/billing?tab=usage`, kind: "account", sameOrigin: true },
      cancelable: true,
    })
    window.dispatchEvent(own)
    expect(own.defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenCalledWith("/billing?tab=usage")

    navigate.mockClear()
    const other = new CustomEvent(pkg!.HEADER_EVENTS.navigate, {
      detail: { href: "https://nodaro.ai/image", kind: "world", sameOrigin: false },
      cancelable: true,
    })
    window.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it("draws the frozen fallback's two links as the element's one child", () => {
    const Fallback = pkg!.HeaderFallback
    const { container } = render(<Fallback />)
    expect(container.querySelectorAll("[data-nodaro-fallback] > a")).toHaveLength(2)
  })
})
