/**
 * The end-to-end cut budget (§2.4 of the inspectors design), in a real browser
 * on a production build (decided 2026-10-07): ≤ 16 ms from a cut keystroke to
 * the commit that strikes the words, on the 3-hour episode (30k words, 3k
 * drops), with the editor's store subscribers mounted beside the inspector
 * (review-cut.tsx). The jsdom test (review-inspector.budget.test.tsx) keeps
 * recording its own time there and does not assert it.
 *
 * Each cut is a real one: a mouse drag over two kept words on screen, then a
 * Delete key press. The time runs from the keydown event's timestamp to the
 * moment the first word's `data-state` turns "cut" in the DOM (a
 * MutationObserver, which reports at the end of that commit). React's
 * Profiler is silent in a production build, so it is not used. The reasons
 * panel and the footer read the edit deferred, so their counts land in a later
 * commit, outside the measurement, as in the jsdom test.
 *
 * GATED: the median of the measured cuts (after a warm-up) is within the
 * budget, and no editor subscriber wakes before the cut commits. The budget is
 * 16 ms on a manual run (`cd frontend && npm run test:perf`). CI runs this file
 * on every PR touching the inspector or its model (review-cut-budget.yml,
 * decided 2026-10-07) with PERF_BUDGET_ALLOWANCE=2, so there it asserts 32 ms:
 * a regression tripwire on a shared runner, not the budget (budget.mjs).
 */
import { expect, test, type Page } from "@playwright/test"
import { cutBudgetMs } from "./budget.mjs"

const BUDGET_MS = cutBudgetMs(process.env)
const WARMUP = 3
const MEASURED = 15

interface Pick {
  /** The row's first word: rows already cut in are not picked again. */
  readonly row: number
  readonly first: number
  readonly from: { readonly x: number; readonly y: number }
  readonly to: { readonly x: number; readonly y: number }
}

interface CutTiming {
  readonly ms: number
  /** The editor subscribers' wake-ups before the keystroke and at its commit. */
  readonly wokeBefore: string
  readonly wokeAtCommit: string
}

declare global {
  interface Window {
    __cut?: { t0: number; ms: number; wokeBefore: string; wokeAtCommit: string }
  }
}

/** Two kept, adjacent words in a row fully on screen whose first word is not in `used`. */
async function pickWords(page: Page, used: readonly number[]): Promise<Pick | null> {
  return page.evaluate((usedRows) => {
    const scroller = document.querySelector<HTMLElement>("[data-testid='review-transcript']")!
    const box = scroller.getBoundingClientRect()
    for (const row of scroller.querySelectorAll<HTMLElement>("[data-review-row]")) {
      const r = row.getBoundingClientRect()
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) continue
      const words = [...row.querySelectorAll<HTMLElement>("[data-w][data-state='kept']")]
      if (words.length < 6 || usedRows.includes(Number(words[0]!.dataset.w))) continue
      const a = words[2]!
      const b = words[3]!
      if (Number(b.dataset.w) !== Number(a.dataset.w) + 1) continue
      const center = (el: HTMLElement) => {
        const c = el.getBoundingClientRect()
        return { x: c.left + c.width / 2, y: c.top + c.height / 2 }
      }
      return { first: Number(a.dataset.w), row: Number(words[0]!.dataset.w), from: center(a), to: center(b) }
    }
    return null
  }, used as number[])
}

/** Arm the measurement for the cut of word `first`: keydown timestamp → its `data-state` turning "cut". */
async function arm(page: Page, first: number): Promise<void> {
  await page.evaluate((w) => {
    const woke = () => JSON.stringify(window.__reviewHarness!.woke)
    const cut = { t0: 0, ms: 0, wokeBefore: woke(), wokeAtCommit: "" }
    window.__cut = cut
    window.addEventListener("keydown", (e) => {
      if (e.key === "Delete" && cut.t0 === 0) cut.t0 = e.timeStamp
    }, { capture: true, once: true })
    const scroller = document.querySelector<HTMLElement>("[data-testid='review-transcript']")!
    const observer = new MutationObserver(() => {
      if (cut.ms > 0 || cut.t0 === 0) return
      if (document.querySelector<HTMLElement>(`[data-w="${w}"]`)?.dataset.state !== "cut") return
      cut.ms = performance.now() - cut.t0
      cut.wokeAtCommit = woke()
      observer.disconnect()
    })
    observer.observe(scroller, { attributes: true, attributeFilter: ["data-state"], subtree: true })
  }, first)
}

/** Let the deferred commits and the debounced write (400 ms idle) land before the next cut. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(800)
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
}

async function cutOnce(page: Page, used: number[]): Promise<CutTiming> {
  let pick = await pickWords(page, used)
  if (!pick) {
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>("[data-testid='review-transcript']")!
      scroller.scrollTop += scroller.clientHeight
    })
    await settle(page)
    pick = await pickWords(page, used)
  }
  expect(pick, "two kept words on screen").not.toBeNull()
  const { row, first, from, to } = pick!
  used.push(row)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 3 })
  await page.mouse.up()
  await expect(page.getByRole("toolbar", { name: "Selection" })).toBeVisible()
  await settle(page)

  await arm(page, first)
  await page.keyboard.press("Delete")
  await page.waitForFunction(() => (window.__cut?.ms ?? 0) > 0, undefined, { timeout: 5_000 })
  const timing = await page.evaluate(() => window.__cut!)
  await settle(page)
  return timing
}

test(`a cut keystroke commits within ${BUDGET_MS} ms on the 3-hour episode, with the editor's subscribers asleep`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/review-cut.html")
  await page.locator("[data-testid='review-transcript'] [data-w]").first().waitFor()
  await settle(page)

  const used: number[] = []
  const timings: number[] = []
  for (let i = 0; i < WARMUP + MEASURED; i++) {
    const cut = await cutOnce(page, used)
    // A cut changes the inspector's own K and nothing in the store (§2.2).
    expect(cut.wokeAtCommit, "no editor subscriber woke before the cut committed").toBe(cut.wokeBefore)
    if (i >= WARMUP) timings.push(cut.ms)
  }

  const sorted = [...timings].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const line = `cut keystroke → commit, median of ${MEASURED}: ${median.toFixed(1)} ms (budget ${BUDGET_MS} ms; min ${sorted[0]!.toFixed(1)}, max ${sorted[sorted.length - 1]!.toFixed(1)})`
  info.annotations.push({ type: "cut budget", description: line })
  console.log(line)
  expect(median).toBeLessThanOrEqual(BUDGET_MS)
})
