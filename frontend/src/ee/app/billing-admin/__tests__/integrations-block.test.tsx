import { describe, it, expect, vi, beforeEach } from "vitest"
import { toast } from "sonner"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"
import { useLocaleStore } from "@/lib/locale-store"
import type { IntegrationKey, MintedIntegrationKey } from "@/ee/hooks/queries/use-deployment-billing"

/**
 * The Integrations block — the billing account mints, lists and revokes the
 * keys its back office authenticates with.
 *
 * THE ONE RULE THIS FILE EXISTS FOR: the bearer is in exactly one response
 * body, once. `GET` never carries it, the list never renders it, and the panel
 * that does render it says so in words and can be dismissed. A key the payer
 * did not copy is not recoverable — it is revoked and replaced — so a panel
 * that quietly disappeared, or a list that looked like it might still hold the
 * value, would both cost a rotation.
 *
 * THE SECOND RULE: revoking is a two-step. One misplaced click stops a running
 * integration, and the refusal is not undoable — a revoked key cannot be
 * un-revoked, only replaced.
 *
 * RTL (R5): logical properties only; no bare `X / Y` counter (it inverts); the
 * bearer, the prefix and the CIDR ranges are Latin technical strings inside an
 * otherwise Hebrew page and carry `dir="ltr"` so bidi does not reorder them.
 */

const KEYS: IntegrationKey[] = [
  {
    id: "k1",
    name: "back office",
    tokenPrefix: "ndr_bill_9f3",
    createdAt: "2026-09-01T00:00:00.000Z",
    // FAR future, deliberately: `isIntegrationKeyLive` reads the real clock, so
    // a plausible-looking expiry turns the live-count assertion below into a
    // test that goes red on a calendar date with no code change.
    expiresAt: "2099-09-01T00:00:00.000Z",
    lastUsedAt: "2026-09-05T00:00:00.000Z",
    revokedAt: null,
    allowedCidrs: ["203.0.113.0/24"],
  },
  {
    id: "k2",
    name: "staging",
    tokenPrefix: "ndr_bill_1ab",
    createdAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: "2026-08-20T00:00:00.000Z",
    allowedCidrs: null,
  },
]

const MINTED: MintedIntegrationKey = {
  id: "k3",
  name: "new one",
  // A zero-entropy stand-in (64 valid hex chars) so the secret scanner does not
  // mistake a fixture for a real bearer.
  token: `ndr_bill_${"a".repeat(64)}`,
  tokenPrefix: "ndr_bill_aaa",
  expiresAt: null,
}

const mintMutate = vi.fn()
const mintReset = vi.fn()
const revokeMutate = vi.fn()
const keysRefetch = vi.fn()

const state = {
  keys: KEYS as IntegrationKey[],
  keysFailed: false,
  minted: undefined as MintedIntegrationKey | undefined,
  mintError: undefined as unknown,
}

vi.mock("@/ee/hooks/queries/use-deployment-billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ee/hooks/queries/use-deployment-billing")>()
  return {
    ...actual,
    useIntegrationKeys: () => ({
      data: state.keysFailed ? undefined : state.keys,
      isLoading: false,
      isError: state.keysFailed,
      refetch: keysRefetch,
    }),
    useMintIntegrationKeyMutation: () => ({
      mutate: mintMutate,
      reset: mintReset,
      isPending: false,
      data: state.minted,
      error: state.mintError,
    }),
    useRevokeIntegrationKeyMutation: () => ({ mutate: revokeMutate, isPending: false }),
  }
})

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { IntegrationsBlock } = await import("../integrations-block")
const { DeploymentBillingError } = await import("@/ee/hooks/queries/use-deployment-billing")

beforeEach(() => {
  vi.clearAllMocks()
  state.keys = KEYS
  state.keysFailed = false
  state.minted = undefined
  state.mintError = undefined
  useLocaleStore.setState({ locale: "he" })
})

function renderBlock() {
  return render(<IntegrationsBlock />)
}

// ── The list ───────────────────────────────────────────────────────────────

describe("the list", () => {
  it("shows a key by its PREFIX, never by a bearer", () => {
    const { container } = renderBlock()
    const row = container.querySelector("[data-testid='integration-key-k1']")!
    expect(row.textContent).toContain("ndr_bill_9f3")
    expect(row.textContent).toContain("back office")
    // Non-vacuity in the direction that matters: no 64-hex bearer anywhere.
    expect(container.textContent ?? "").not.toMatch(/ndr_bill_[0-9a-f]{64}/)
  })

  it("labels a revoked key so a dead integration is diagnosable", () => {
    const { container } = renderBlock()
    const row = container.querySelector("[data-testid='integration-key-k2']")!
    expect(row.textContent).toContain(he["billingAdmin.integrationsRevokedAt"] as string)
  })

  it("says a never-used key has never been used, rather than showing an em dash alone", () => {
    const { container } = renderBlock()
    const row = container.querySelector("[data-testid='integration-key-k2']")!
    expect(row.textContent).toContain(he["billingAdmin.integrationsNeverUsed"] as string)
  })

  it("counts the LIVE keys against the cap, and never as a bare `X / Y`", () => {
    // k2 is revoked, so one of the five is in use.
    const { container } = renderBlock()
    const count = container.querySelector("[data-testid='integration-count']")!
    expect(count.textContent).toContain("1")
    expect(count.textContent).toContain("5")
    expect(count.textContent ?? "").not.toMatch(/\d\s*\/\s*\d/)
  })

  it("an EMPTY list reads as empty; a FAILED read does not", () => {
    state.keys = []
    const { container } = renderBlock()
    expect(container.textContent).toContain(he["billingAdmin.integrationsEmpty"] as string)
    expect(container.textContent).not.toContain(he["billingAdmin.listError"] as string)
  })

  it("a failed read says so instead of 'no keys yet', and offers a retry", () => {
    state.keysFailed = true
    const { container } = renderBlock()
    expect(container.textContent).toContain(he["billingAdmin.listError"] as string)
    expect(container.textContent).not.toContain(he["billingAdmin.integrationsEmpty"] as string)
    fireEvent.click(container.querySelector("[data-testid='integrations-retry']")!)
    expect(keysRefetch).toHaveBeenCalled()
  })
})

// ── The mint form ──────────────────────────────────────────────────────────

describe("the mint form validates before it spends a round trip", () => {
  it("refuses a nameless key and never calls the mutation", () => {
    const { container } = renderBlock()
    fireEvent.click(container.querySelector("[data-testid='integration-mint']")!)
    expect(mintMutate).not.toHaveBeenCalled()
    expect(container.querySelector("[data-testid='integration-error']")!.textContent).toContain(
      he["billingAdmin.errInvalidName"] as string,
    )
  })

  it("refuses an expiry in the past — a key born expired is indistinguishable from a revoked one", () => {
    const { container } = renderBlock()
    fireEvent.change(container.querySelector("[data-testid='integration-name']")!, {
      target: { value: "back office" },
    })
    fireEvent.change(container.querySelector("[data-testid='integration-expiry']")!, {
      target: { value: "2020-01-01" },
    })
    fireEvent.click(container.querySelector("[data-testid='integration-mint']")!)
    expect(mintMutate).not.toHaveBeenCalled()
    expect(container.querySelector("[data-testid='integration-error']")!.textContent).toContain(
      he["billingAdmin.errInvalidExpiry"] as string,
    )
  })

  it("sends the name alone when no expiry and no ranges were given", () => {
    const { container } = renderBlock()
    fireEvent.change(container.querySelector("[data-testid='integration-name']")!, {
      target: { value: "  back office  " },
    })
    fireEvent.click(container.querySelector("[data-testid='integration-mint']")!)
    expect(mintMutate.mock.calls[0][0]).toEqual({ name: "back office" })
  })

  it("sends the expiry as an instant and the ranges as a trimmed list", () => {
    const { container } = renderBlock()
    fireEvent.change(container.querySelector("[data-testid='integration-name']")!, {
      target: { value: "back office" },
    })
    fireEvent.change(container.querySelector("[data-testid='integration-expiry']")!, {
      target: { value: "2099-01-31" },
    })
    fireEvent.change(container.querySelector("[data-testid='integration-cidrs']")!, {
      // Commas AND newlines, with blanks the payer left behind.
      target: { value: "203.0.113.0/24,\n\n 10.0.0.0/8 \n" },
    })
    fireEvent.click(container.querySelector("[data-testid='integration-mint']")!)
    const call = mintMutate.mock.calls[0][0] as {
      name: string
      expiresAt: string
      allowedCidrs: string[]
    }
    expect(call.name).toBe("back office")
    expect(call.allowedCidrs).toEqual(["203.0.113.0/24", "10.0.0.0/8"])
    // An ISO instant, not the bare `yyyy-mm-dd` the input holds: the column is
    // `timestamptz` and a bare date is midnight UTC, which is in the past for
    // half the world on the day it is chosen.
    expect(new Date(call.expiresAt).toISOString()).toBe(call.expiresAt)
    expect(new Date(call.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it("caps the name at the route's own maximum, so an over-long one never reaches it", () => {
    // The server answers `invalid_name` for an EMPTY name and for an over-long
    // one alike, and that code renders as "give the key a name" — which points
    // a payer who gave it 200 characters at the wrong problem entirely. The
    // input cannot hold more than the route accepts, and the guard behind it
    // has its own sentence.
    const { container } = renderBlock()
    const name = container.querySelector("[data-testid='integration-name']") as HTMLInputElement
    expect(name.getAttribute("maxLength")).toBe("80")

    fireEvent.change(name, { target: { value: "x".repeat(81) } })
    fireEvent.click(container.querySelector("[data-testid='integration-mint']")!)
    expect(mintMutate).not.toHaveBeenCalled()
    const shown = container.querySelector("[data-testid='integration-error']")!.textContent
    expect(shown).toBe((he["billingAdmin.errNameTooLong"] as string).replace("{max}", "80"))
    expect(shown).not.toBe(he["billingAdmin.errInvalidName"] as string)
  })

  it("refuses more source ranges than the route accepts, before sending them", () => {
    const { container } = renderBlock()
    fireEvent.change(container.querySelector("[data-testid='integration-name']")!, {
      target: { value: "back office" },
    })
    fireEvent.change(container.querySelector("[data-testid='integration-cidrs']")!, {
      target: { value: Array.from({ length: 21 }, (_, i) => `10.0.${i}.0/24`).join("\n") },
    })
    fireEvent.click(container.querySelector("[data-testid='integration-mint']")!)
    expect(mintMutate).not.toHaveBeenCalled()
    expect(container.querySelector("[data-testid='integration-error']")!.textContent).toBe(
      (he["billingAdmin.errTooManyCidrs"] as string).replace("{max}", "20"),
    )
  })
})

// ── The copy-once panel ────────────────────────────────────────────────────

describe("the bearer is shown once, and the page says so", () => {
  it("renders the token with the shown-once sentence and a copy button", () => {
    state.minted = MINTED
    const { container } = renderBlock()
    const panel = container.querySelector("[data-testid='integration-token']")!
    expect(panel.textContent).toContain(MINTED.token)
    expect(panel.textContent).toContain(he["billingAdmin.integrationsTokenOnce"] as string)
    expect(container.querySelector("[data-testid='integration-copy']")).not.toBeNull()
  })

  it("renders the bearer left-to-right inside an RTL page", () => {
    // A Latin hex string in an RTL paragraph is reordered by the bidi
    // algorithm around its punctuation, so what the payer copies by eye is not
    // what was minted. `dir` is correctness here, not typography.
    state.minted = MINTED
    const { container } = renderBlock()
    const value = container.querySelector("[data-testid='integration-token-value']")!
    expect(value.getAttribute("dir")).toBe("ltr")
  })

  it("copies the token to the clipboard", async () => {
    state.minted = MINTED
    const writeText = vi.fn().mockResolvedValue(undefined)
    // jsdom has no clipboard at all — the handler must not assume one.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const { container } = renderBlock()
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='integration-copy']")!)
    })
    expect(writeText).toHaveBeenCalledWith(MINTED.token)
  })

  it("survives a browser with no clipboard rather than throwing on the click", async () => {
    state.minted = MINTED
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true })
    const { container } = renderBlock()
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='integration-copy']")!)
    })
    // Still on screen: the payer can select it by hand.
    expect(container.querySelector("[data-testid='integration-token-value']")!.textContent).toBe(
      MINTED.token,
    )
  })

  it("dismissing it RESETS the mutation, so the token is not re-derivable from the page", () => {
    state.minted = MINTED
    const { container } = renderBlock()
    fireEvent.click(container.querySelector("[data-testid='integration-token-done']")!)
    expect(mintReset).toHaveBeenCalled()
  })

  it("the list itself never carries a token field, even when one was just minted", () => {
    state.minted = MINTED
    const { container } = renderBlock()
    const list = container.querySelector("[data-testid='integration-list']")!
    expect(list.textContent ?? "").not.toContain(MINTED.token)
  })
})

// ── A second mint would discard the first bearer ───────────────────────────

describe("the copy-once panel closes the door behind it", () => {
  it("disables Create while a bearer is on screen, and re-enables it after dismissal", () => {
    // `mint.data` IS the only copy of the bearer. A second mint overwrites it
    // — with the panel still open, showing what looks like the same key — and
    // the first, uncopied, is then unrecoverable: it can only be revoked and
    // replaced.
    state.minted = MINTED
    const { container, rerender } = renderBlock()
    const button = () => container.querySelector("[data-testid='integration-mint']") as HTMLButtonElement
    expect(button().disabled).toBe(true)

    fireEvent.click(container.querySelector("[data-testid='integration-token-done']")!)
    expect(mintReset).toHaveBeenCalled()
    // The reset is what empties `mint.data`; the hook is mocked here, so the
    // state it would have cleared is cleared by hand.
    state.minted = undefined
    rerender(<IntegrationsBlock />)
    expect(button().disabled).toBe(false)
  })

  it("empties the form on success, so the next key is not a near-duplicate of the last", () => {
    const { container } = renderBlock()
    const name = container.querySelector("[data-testid='integration-name']") as HTMLInputElement
    const expiry = container.querySelector("[data-testid='integration-expiry']") as HTMLInputElement
    const cidrs = container.querySelector("[data-testid='integration-cidrs']") as HTMLTextAreaElement
    fireEvent.change(name, { target: { value: "back office" } })
    fireEvent.change(expiry, { target: { value: "2099-01-31" } })
    fireEvent.change(cidrs, { target: { value: "10.0.0.0/8" } })
    fireEvent.click(container.querySelector("[data-testid='integration-mint']")!)

    const options = mintMutate.mock.calls[0][1] as { onSuccess: () => void }
    act(() => options.onSuccess())
    expect(name.value).toBe("")
    expect(expiry.value).toBe("")
    expect(cidrs.value).toBe("")
  })
})

// ── The refusals ───────────────────────────────────────────────────────────

describe("the route's refusals reach the payer as sentences, not as codes", () => {
  it("surfaces the five-key limit IN the block, where the button is", () => {
    // A toast is not enough: the payer is looking at a list of five keys and
    // needs to be told which of them to revoke, next to the button that
    // refused.
    state.mintError = new DeploymentBillingError(409, "key_limit_reached", "too many")
    const { container } = renderBlock()
    expect(container.querySelector("[data-testid='integration-error']")!.textContent).toContain(
      he["billingAdmin.errKeyLimitReached"] as string,
    )
  })

  it("surfaces an invalid CIDR the server caught", () => {
    state.mintError = new DeploymentBillingError(400, "invalid_cidr", "bad range")
    const { container } = renderBlock()
    expect(container.querySelector("[data-testid='integration-error']")!.textContent).toContain(
      he["billingAdmin.errInvalidCidr"] as string,
    )
  })

  it("surfaces the browser-session-only refusal in its own words", () => {
    state.mintError = new DeploymentBillingError(403, "payer_session_required", "no")
    const { container } = renderBlock()
    expect(container.querySelector("[data-testid='integration-error']")!.textContent).toContain(
      he["billingAdmin.errPayerSessionRequired"] as string,
    )
  })

  it("refuses WITHOUT a toast — the inline sentence is the whole surface", () => {
    // The query client's default `mutations.onError` toasts `error.message`,
    // which is the server's ENGLISH sentence, on a Hebrew-first page and on top
    // of the localized line below the button. The mint mutation defines its own
    // handler to suppress it; nothing here may put the raw message on screen.
    state.mintError = new DeploymentBillingError(409, "key_limit_reached", "too many live keys")
    const { container } = renderBlock()
    expect(toast.error).not.toHaveBeenCalled()
    expect(container.textContent ?? "").not.toContain("too many live keys")
  })

  it("announces the refusal rather than only painting it", () => {
    state.mintError = new DeploymentBillingError(400, "invalid_cidr", "bad range")
    const { container } = renderBlock()
    expect(container.querySelector("[data-testid='integration-error']")!.getAttribute("role")).toBe(
      "alert",
    )
  })
})

// ── Revoking ───────────────────────────────────────────────────────────────

describe("revoking takes two clicks", () => {
  it("the first click asks, and revokes nothing", () => {
    const { container } = renderBlock()
    fireEvent.click(container.querySelector("[data-testid='integration-revoke-k1']")!)
    expect(revokeMutate).not.toHaveBeenCalled()
    expect(container.querySelector("[data-testid='integration-revoke-confirm-k1']")).not.toBeNull()
    expect(container.textContent).toContain(he["billingAdmin.integrationsRevokeWarn"] as string)
  })

  it("the second click revokes that key, by id", () => {
    const { container } = renderBlock()
    fireEvent.click(container.querySelector("[data-testid='integration-revoke-k1']")!)
    fireEvent.click(container.querySelector("[data-testid='integration-revoke-confirm-k1']")!)
    expect(revokeMutate).toHaveBeenCalledWith({ id: "k1" })
  })

  it("backing out revokes nothing and closes the question", () => {
    const { container } = renderBlock()
    fireEvent.click(container.querySelector("[data-testid='integration-revoke-k1']")!)
    fireEvent.click(container.querySelector("[data-testid='integration-revoke-cancel-k1']")!)
    expect(revokeMutate).not.toHaveBeenCalled()
    expect(container.querySelector("[data-testid='integration-revoke-confirm-k1']")).toBeNull()
  })

  it("offers no revoke on a key that is already revoked", () => {
    const { container } = renderBlock()
    expect(container.querySelector("[data-testid='integration-revoke-k2']")).toBeNull()
  })

  it("moves focus to the confirm button, which replaced the one that had it", () => {
    // The Revoke button UNMOUNTS when the question opens. Without this the
    // focus falls to the document body and a keyboard payer has to walk back
    // through the whole list to the row they were already on.
    const { container } = renderBlock()
    fireEvent.click(container.querySelector("[data-testid='integration-revoke-k1']")!)
    expect(document.activeElement).toBe(
      container.querySelector("[data-testid='integration-revoke-confirm-k1']"),
    )
  })
})

describe("what a screen reader is told", () => {
  it('the copy button\'s "copied" state is inside a polite live region', async () => {
    // The label changing is the ONLY confirmation that the bearer reached the
    // clipboard, and a silent change confirms nothing.
    state.minted = MINTED
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const { container } = renderBlock()
    const live = container.querySelector("[data-testid='integration-copy'] [aria-live='polite']")!
    expect(live.textContent).toBe(he["billingAdmin.integrationsCopy"] as string)
    await act(async () => {
      fireEvent.click(container.querySelector("[data-testid='integration-copy']")!)
    })
    expect(live.textContent).toBe(he["billingAdmin.integrationsCopied"] as string)
  })
})

// ── R5 ─────────────────────────────────────────────────────────────────────

describe("R5 — Hebrew and RTL", () => {
  it("uses logical properties only", () => {
    state.minted = MINTED
    const { container } = renderBlock()
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr)-\d/)
  })

  it("renders no bare `X / Y` counter anywhere in the block", () => {
    // CIDR notation legitimately carries a slash between digits, so the ranges
    // are excluded by their own attribute rather than by weakening the rule.
    state.minted = MINTED
    const { container } = renderBlock()
    for (const el of container.querySelectorAll("[data-cidr]")) el.remove()
    // CIDR notation and a locale date both carry a slash between digits and
    // neither is a counter, so both are excluded rather than the rule weakened.
    const prose = (container.textContent ?? "").replace(/\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/g, "")
    expect(prose).not.toMatch(/\d\s*\/\s*\d/)
  })

  it("renders in Hebrew when the locale is Hebrew", () => {
    renderBlock()
    expect(screen.getByText(he["billingAdmin.integrationsTitle"] as string)).toBeInTheDocument()
  })

  it("renders in English when the locale is English", () => {
    useLocaleStore.setState({ locale: "en" })
    renderBlock()
    expect(screen.getByText(en["billingAdmin.integrationsTitle"])).toBeInTheDocument()
  })
})
