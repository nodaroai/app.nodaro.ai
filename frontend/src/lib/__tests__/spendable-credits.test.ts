import { describe, it, expect } from "vitest"
import { spendableCredits } from "../spendable-credits"

/**
 * Track A (D12/R-A) — the one helper every client credit gate and every credit
 * display goes through.
 *
 * The rule it exists to make un-copyable: under a deployment payer the
 * allowance is VISIBLE from the moment a payer exists, but it only BINDS once
 * the deployment flips `billing.allowances` to `"enforce"` — and the server
 * says which by sending `allowance.enforced`. A client that refuses a run on a
 * visible-but-unenforced allowance refuses runs the payer's pool would have
 * paid for (rollout step 5 promises "nobody is refused"); a client that shows
 * `total` under a payer shows a FROZEN signup grant nothing debits.
 *
 * So the helper answers three questions, not one: `gateApplies` says whether a
 * client-side comparison is ALLOWED to happen at all, `figure` is what such a
 * comparison uses, and `displayFigure` is what a SCREEN may show.
 *
 * `gateApplies` is the ruling that superseded "fall back to `total`". On a
 * payer instance the requester's `total` is a FROZEN signup grant that no
 * generation ever draws from, so a client precheck against it is not a
 * conservative fallback — it is a lie in both directions. In that window the
 * server (the payer's pool, and later the RPC's allowance check) is the only
 * thing entitled to refuse.
 *
 * WHICH IS WHY THE HELPER TAKES THE SURFACE FLAG. `allowance: null` carries
 * TWO meanings on the wire and the body cannot tell them apart: the caller IS
 * the payer (D13), or the figure was UNAVAILABLE (a read error, an unreadable
 * settings row). Reading the second as "no allowance ⇒ gate on `total`" put
 * the pre-flip refusal back on a payer instance over a transient failure — and
 * the server's 15 s balance cache then held that refusal for everyone. So on a
 * payer instance a null allowance NEVER licenses a client refusal; on mainline,
 * where the key does not travel at all, `total` is the wallet and the gate is
 * exactly what it always was.
 */

/** `billingSurface().deploymentPayer` — the second argument, named. */
const MAINLINE = false
const PAYER = true

describe("spendableCredits", () => {
  describe("the gate figure", () => {
    it("is the allowance's remaining once the server says it is enforced", () => {
      const s = spendableCredits(
        { total: 1500, allowance: { granted: 400_000, remaining: 40, enforced: true } },
        PAYER,
      )
      expect(s.figure).toBe(40)
      expect(s.enforced).toBe(true)
    })

    it("reports `total` while the allowance is visible but NOT enforced — and forbids the gate", () => {
      // Rollout step 5: the allowance is on screen and the server enforces the
      // payer's pool alone. `total` here is the FROZEN signup grant, so it is
      // not a fallback ceiling — it is a number nothing debits. The figure is
      // still reported (never Infinity, never a fake ceiling), but
      // `gateApplies` is what stops a caller comparing against it.
      const s = spendableCredits(
        { total: 1500, allowance: { granted: 400_000, remaining: 0, enforced: false } },
        PAYER,
      )
      expect(s.figure).toBe(1500)
      expect(s.enforced).toBe(false)
      expect(s.gateApplies).toBe(false)
    })

    it("reports `total` with no enforcement flag at all — and still forbids the gate", () => {
      // A backend that predates the flag is NOT "assume enforced"; but neither
      // is it licence to refuse on the frozen grant.
      const s = spendableCredits({ total: 1500, allowance: { granted: 400_000, remaining: 0 } }, PAYER)
      expect(s.figure).toBe(1500)
      expect(s.enforced).toBe(false)
      expect(s.gateApplies).toBe(false)
    })

    it("is `total` on mainline, where the key never travels", () => {
      const s = spendableCredits({ total: 1500 }, MAINLINE)
      expect(s.figure).toBe(1500)
      expect(s.enforced).toBe(false)
      expect(s.allowance).toBeNull()
    })

    it("treats an explicit null as 'no allowance applies', never as remaining 0", () => {
      // The payer reading its own balance (D13): answering 0 would refuse the
      // runs of the account that owns the pool.
      const s = spendableCredits({ total: 250_000, allowance: null }, PAYER)
      expect(s.figure).toBe(250_000)
      expect(s.enforced).toBe(false)
    })

    it("is 0 for a genuinely exhausted ENFORCED allowance, whatever the grant says", () => {
      const s = spendableCredits(
        { total: 1500, allowance: { granted: 400_000, remaining: 0, enforced: true } },
        PAYER,
      )
      expect(s.figure).toBe(0)
    })
  })

  describe("the display figure", () => {
    it("is the visible allowance whether or not it is enforced", () => {
      // R-A: visible when a payer is active, enforced only when the profile
      // says so. A card that showed `total` under a payer would show the
      // frozen signup grant — a number nothing debits and nothing tops up.
      const off = spendableCredits(
        { total: 1500, allowance: { granted: 400_000, remaining: 399_000, enforced: false } },
        PAYER,
      )
      const on = spendableCredits(
        { total: 1500, allowance: { granted: 400_000, remaining: 399_000, enforced: true } },
        PAYER,
      )
      expect(off.displayFigure).toBe(399_000)
      expect(on.displayFigure).toBe(399_000)
    })

    it("falls back to `total` with no allowance, and never reads null as 0", () => {
      expect(spendableCredits({ total: 1500 }, MAINLINE).displayFigure).toBe(1500)
      expect(spendableCredits({ total: 250_000, allowance: null }, PAYER).displayFigure).toBe(250_000)
    })

    it("shows `total` on a payer instance whose allowance is UNAVAILABLE", () => {
      // The read failed, so there is no allowance to show: `total` is the only
      // number on hand and a card must say something. What must NOT happen is a
      // refusal on it — that is `gateApplies`, below.
      const s = spendableCredits({ total: 1500, allowance: null }, PAYER)
      expect(s.displayFigure).toBe(1500)
      expect(s.allowance).toBeNull()
    })

    it("hands the allowance back untouched, for the granted/remaining pair", () => {
      const a = { granted: 400_000, remaining: 399_000, enforced: false }
      expect(spendableCredits({ total: 1500, allowance: a }, PAYER).allowance).toEqual(a)
    })
  })

  describe("whether a client gate may compare at all", () => {
    it("lets mainline gate: `total` IS the wallet every run debits", () => {
      expect(spendableCredits({ total: 1500 }, MAINLINE).gateApplies).toBe(true)
    })

    it("lets mainline gate on an explicit null too — the wallet is still live", () => {
      // A mainline backend does not send the key at all; a null one changes
      // nothing there, because `total` is what every run debits.
      const s = spendableCredits({ total: 250_000, allowance: null }, MAINLINE)
      expect(s.gateApplies).toBe(true)
      expect(s.figure).toBe(250_000)
    })

    it("REFUSES to gate on a PAYER instance when the allowance is null", () => {
      // `null` means two things and the body cannot tell them apart: the caller
      // IS the payer (D13), or the figure was UNAVAILABLE — a read error, an
      // unreadable settings row. Gating on `total` covered the first case and
      // broke the second: on a payer instance `total` is the frozen signup
      // grant, so ONE failed allowance read re-armed the pre-flip refusal that
      // ruling R-C exists to remove, and the server's 15 s balance cache held
      // it there. On a payer instance the browser refuses only on an allowance
      // that is PRESENT and ENFORCED; everything else is the server's call —
      // including the payer's own runs, which its pool covers by construction.
      const s = spendableCredits({ total: 250_000, allowance: null }, PAYER)
      expect(s.gateApplies).toBe(false)
      // The display still has a number, and it is `total` — see above.
      expect(s.displayFigure).toBe(250_000)
    })

    it("lets an ENFORCED allowance gate: `remaining` is the number the server refuses on", () => {
      const s = spendableCredits(
        { total: 1500, allowance: { granted: 400_000, remaining: 40, enforced: true } },
        PAYER,
      )
      expect(s.gateApplies).toBe(true)
      expect(s.figure).toBe(40)
    })

    it("REFUSES to gate while the allowance is VISIBLE but not enforced", () => {
      // The payer granted 10,000; the frozen grant says 1,500. Comparing a
      // 4,000-credit run against 1,500 disables Generate over a number nothing
      // debits, tops up, or checks. Nobody may refuse here but the server.
      const s = spendableCredits(
        { total: 1500, allowance: { granted: 10_000, remaining: 10_000, enforced: false } },
        PAYER,
      )
      expect(s.gateApplies).toBe(false)
    })

    it("REFUSES to gate when the server sent an allowance with no enforcement flag", () => {
      // An absent flag is "not enforced" — and on a payer instance that still
      // means the frozen grant is not a lawful thing to refuse on.
      const s = spendableCredits({ total: 1500, allowance: { granted: 10_000, remaining: 10_000 } }, PAYER)
      expect(s.gateApplies).toBe(false)
    })

    it("reads a PRESENT allowance without consulting the surface flag at all", () => {
      // The flag answers "is this a payer instance" from a cached,
      // deployment-grain query that can be cold. A PRESENT allowance already
      // proves the instance has a payer, so the enforcement bit alone decides
      // there — a cold flag can never re-arm the refusal the pre-flip window
      // forbids, and can never suppress the one enforcement licenses.
      for (const flag of [MAINLINE, PAYER]) {
        const visible = spendableCredits(
          { total: 1500, allowance: { granted: 10_000, remaining: 10_000, enforced: false } },
          flag,
        )
        const enforced = spendableCredits(
          { total: 1500, allowance: { granted: 10_000, remaining: 40, enforced: true } },
          flag,
        )
        expect(visible.gateApplies).toBe(false)
        expect(enforced.gateApplies).toBe(true)
      }
    })

    it("REFUSES to gate a WITHHELD user, whose frozen grant is 0", () => {
      // The dead-Generate-button case: a user provisioned under a payer before
      // any signup grant landed reads `total: 0`. Gating on that disables every
      // run on the instance while the payer's pool would have paid for them.
      const s = spendableCredits(
        { total: 0, allowance: { granted: 10_000, remaining: 10_000, enforced: false } },
        PAYER,
      )
      expect(s.gateApplies).toBe(false)
    })

    it("is the ONLY thing that separates the gate figure from the display figure", () => {
      // Whenever a gate may run, the two numbers coincide — which is why a
      // display surface can always take `displayFigure` and be right.
      const cases = [
        [{ total: 1500 }, MAINLINE],
        [{ total: 250_000, allowance: null }, MAINLINE],
        [{ total: 1500, allowance: { granted: 400_000, remaining: 40, enforced: true } }, PAYER],
      ] as const
      for (const [b, payer] of cases) {
        const s = spendableCredits(b, payer)
        expect(s.gateApplies).toBe(true)
        expect(s.figure).toBe(s.displayFigure)
      }
    })
  })

  it("stays in RAW credits — no display-unit conversion happens here", () => {
    const s = spendableCredits(
      { total: 1500, allowance: { granted: 200_000, remaining: 199_950, enforced: true } },
      PAYER,
    )
    expect(s.figure).toBe(199_950) // not × 2000
    expect(s.displayFigure).toBe(199_950)
  })
})
