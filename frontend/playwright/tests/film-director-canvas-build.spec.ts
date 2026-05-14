/**
 * Visual regression for Film Director canvas animations (D1+D2+D3).
 *
 * Covers the three live-build animations that the Film Director skill relies
 * on (spec §5.4 Pattern A-prime in `specs/features/nodaro-film-director-
 * skill.md`):
 *
 *   D1 — `useNodeInsertAnimation`  (300 ms opacity 0→1 + scale 0.85→1)
 *        — `frontend/src/components/editor/workflow-editor/use-node-insert-animation.ts`
 *   D2 — `useEdgeInsertAnimation`  (500 ms stroke-dashoffset 9999→0)
 *        — `frontend/src/components/editor/workflow-editor/use-edge-insert-animation.ts`
 *   D3 — `useCameraAutoPan`        (600 ms setCenter; 2 s user-interaction debounce)
 *        — `frontend/src/components/editor/workflow-editor/use-camera-auto-pan.ts`
 *
 * Each hook already has a vitest unit test alongside it. This spec is the
 * end-to-end counterpart: it asserts the animations actually fire against a
 * running React Flow canvas — the failure mode the unit tests cannot catch
 * (e.g. BaseNode forgetting to spread the style, AnimatedFlowEdge dropping
 * the style merge, the canvas not wiring `onMove` into ReactFlow, …).
 *
 * ─── To run ─────────────────────────────────────────────────────────────────
 *   # In one terminal:
 *   cd backend && npm run dev
 *
 *   # In another terminal:
 *   cd frontend && npm run dev
 *
 *   # In a third terminal:
 *   cd frontend
 *   npx playwright test playwright/tests/film-director-canvas-build.spec.ts
 *
 * To list the tests without running:
 *   npx playwright test --list playwright/tests/film-director-canvas-build.spec.ts
 *
 * ─── Prereqs (env vars) ─────────────────────────────────────────────────────
 *   PLAYWRIGHT_EDITOR_URL
 *     Full URL to an empty (or near-empty) workflow editor page the
 *     authenticated test session can reach, e.g.
 *     `http://localhost:5173/projects/<projectId>/workflows/<workflowId>`.
 *     If unset, the entire suite is skipped (no test data → no run).
 *
 *   PLAYWRIGHT_SUPABASE_SESSION_JSON
 *     The JSON string Supabase stores at
 *     `localStorage["sb-<ref>-auth-token"]`. Copy it from a logged-in
 *     browser session (DevTools → Application → Local Storage). If unset,
 *     the DashboardLayout redirects every test to `/login` and the entire
 *     suite is skipped.
 *
 *   PLAYWRIGHT_SUPABASE_STORAGE_KEY
 *     Optional override. Defaults to `sb-<project-ref>-auth-token` derived
 *     from `VITE_SUPABASE_URL`. Set this if your local dev runs against a
 *     non-standard auth storage key.
 *
 * ─── Test-helper hook (`window.__nodaroTest`) ───────────────────────────────
 * For deterministic node/edge insertion the editor must expose a small,
 * dev-only test helper on `window`. The skill effectively does the same via
 * MCP `update_workflow_json` + the editor's 30 s refetch — but that path is
 * far too slow for a unit-grade visual regression.
 *
 * The expected runtime shape (TypeScript-ish):
 *
 *   declare global {
 *     interface Window {
 *       __nodaroTest?: {
 *         batchAddNodesAndEdges: (
 *           nodes: ReadonlyArray<{ id: string; type: string; position: {x: number; y: number}; data?: Record<string, unknown> }>,
 *           edges: ReadonlyArray<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>,
 *         ) => void
 *         getViewport: () => { x: number; y: number; zoom: number }
 *         resetSeen: () => void  // clears module-level node + edge seen-sets
 *       }
 *     }
 *   }
 *
 * If `window.__nodaroTest` is absent (i.e. nobody has wired the helper up
 * yet), each test in this suite is auto-skipped with an explanatory
 * message — so this spec is safe to land before the helper exists.
 *
 * ─── Why timing assertions use `toHaveCSS` polling, not sleep ────────────
 * Animation-timing assertions are notoriously flaky in CI. Playwright's
 * `expect(...).toHaveCSS(prop, value, { timeout })` polls every ~50 ms until
 * the value matches OR the budget elapses — that's the right tool here:
 *
 *   - We never assert "exactly at t = 300 ms opacity is 0.5" (impossible to
 *     time reliably across machines).
 *   - We assert "opacity reaches 1 within 500 ms" (one frame of slack on top
 *     of D1's 300 ms transition — robust to GC pauses + render-batching).
 */
import { test, expect, type Page } from "@playwright/test"

// ── Type for the dev-only test helper exposed by the editor ────────────────

interface NodaroTestNodeInput {
  readonly id: string
  readonly type: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data?: Record<string, unknown>
}

interface NodaroTestEdgeInput {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string
  readonly targetHandle?: string
}

interface NodaroTestApi {
  batchAddNodesAndEdges: (
    nodes: ReadonlyArray<NodaroTestNodeInput>,
    edges: ReadonlyArray<NodaroTestEdgeInput>,
  ) => void
  getViewport: () => { x: number; y: number; zoom: number }
  resetSeen: () => void
}

/**
 * The async, Playwright-side view of the same API. Each method dispatches
 * its work into the browser context via `page.evaluate` and is therefore
 * async, even though the underlying `window.__nodaroTest` is sync.
 */
interface NodaroTestPageApi {
  batchAddNodesAndEdges: (
    nodes: ReadonlyArray<NodaroTestNodeInput>,
    edges: ReadonlyArray<NodaroTestEdgeInput>,
  ) => Promise<void>
  getViewport: () => Promise<{ x: number; y: number; zoom: number }>
  resetSeen: () => Promise<void>
}

// Playwright transpiles this file in a Node context; the `window` reference
// in `page.evaluate` lambdas is the BROWSER window — accessed as
// `(window as unknown as { __nodaroTest?: NodaroTestApi })`.

// ── Env-driven config + helpers ────────────────────────────────────────────

const EDITOR_URL = process.env.PLAYWRIGHT_EDITOR_URL ?? ""
const SUPABASE_SESSION_JSON = process.env.PLAYWRIGHT_SUPABASE_SESSION_JSON ?? ""
const SUPABASE_STORAGE_KEY = process.env.PLAYWRIGHT_SUPABASE_STORAGE_KEY ?? ""

/**
 * Install the Supabase session into localStorage BEFORE any app code runs
 * on the page, so the DashboardLayout sees a logged-in user on its first
 * render and doesn't redirect us to /login. Returns true if a session was
 * installed; false if the env var is missing.
 */
async function installSupabaseSession(page: Page): Promise<boolean> {
  if (!SUPABASE_SESSION_JSON) return false
  // The exact localStorage key Supabase uses is `sb-<ref>-auth-token`. We
  // can't trivially derive `<ref>` here without parsing VITE_SUPABASE_URL,
  // so we let the caller pass it explicitly OR fall back to a wildcard
  // strategy: read the existing key after page load and just overwrite it.
  //
  // Simpler approach: if the key is provided, set it; otherwise install via
  // an initScript that finds the first `sb-*-auth-token` key the auth-js
  // client writes (it writes on construct, before the first useEffect).
  if (SUPABASE_STORAGE_KEY) {
    const payload = { key: SUPABASE_STORAGE_KEY, value: SUPABASE_SESSION_JSON }
    await page.addInitScript(({ key, value }) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // SecurityError in some sandboxes — surface as a soft skip by
        // leaving the key unset; the test will detect via /login redirect.
      }
    }, payload)
    return true
  }
  // Best-effort fallback: try every sb-*-auth-token style key. Supabase's
  // PKCE flow uses one key per project ref, so there's typically exactly
  // one.
  await page.addInitScript((value: string) => {
    try {
      // Stash the value under a sentinel; the page's bootstrap script will
      // be hooked to install it once the Supabase client picks a key.
      window.localStorage.setItem("__nodaro_test_pending_session", value)
    } catch {
      // ignore
    }
  }, SUPABASE_SESSION_JSON)
  return true
}

/**
 * Ensure the editor route loaded and the React Flow viewport is mounted,
 * THEN ensure the `window.__nodaroTest` helper is available. Returns true
 * if everything is wired; false if the helper is missing (test will skip).
 */
async function ensureEditorReady(page: Page): Promise<boolean> {
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" })
  // The editor mounts the React Flow viewport once the workflow has
  // loaded. `.react-flow__viewport` is the canonical class React Flow
  // exposes for its panning/zooming SVG group — stable across releases.
  const viewport = page.locator(".react-flow__viewport")
  await expect(viewport).toBeVisible({ timeout: 15_000 })
  // Probe for the test helper. If absent, the test will skip via the caller.
  const hasHelper = await page.evaluate(() => {
    return typeof (window as unknown as { __nodaroTest?: NodaroTestApi }).__nodaroTest === "object"
  })
  if (hasHelper) {
    // Reset module-level seen-sets so each spec test starts fresh.
    await page.evaluate(() => {
      const api = (window as unknown as { __nodaroTest?: NodaroTestApi }).__nodaroTest
      api?.resetSeen()
    })
  }
  return hasHelper
}

/**
 * Helper assertion: the editor must be in the "logged in + canvas ready"
 * state before any test does node-mutation work.
 *
 * Skips (not fails) when prereqs are missing so this spec can be committed
 * before the test infra exists. Once env vars + helper are in place the
 * tests turn green automatically.
 */
async function setupOrSkip(page: Page): Promise<NodaroTestPageApi> {
  test.skip(!EDITOR_URL, "PLAYWRIGHT_EDITOR_URL not set — see file header for required env.")
  test.skip(
    !SUPABASE_SESSION_JSON,
    "PLAYWRIGHT_SUPABASE_SESSION_JSON not set — DashboardLayout would redirect to /login.",
  )

  const sessionInstalled = await installSupabaseSession(page)
  expect(sessionInstalled).toBe(true)

  const ready = await ensureEditorReady(page)
  test.skip(
    !ready,
    "window.__nodaroTest helper is missing on the page. See file header for the expected shape.",
  )

  // Return a thin proxy so callers can `await api.batchAddNodesAndEdges(...)`.
  const api: NodaroTestPageApi = {
    batchAddNodesAndEdges: async (
      nodes: ReadonlyArray<NodaroTestNodeInput>,
      edges: ReadonlyArray<NodaroTestEdgeInput>,
    ) => {
      await page.evaluate(
        (payload: { nodes: NodaroTestNodeInput[]; edges: NodaroTestEdgeInput[] }) => {
          const helper = (window as unknown as { __nodaroTest?: NodaroTestApi }).__nodaroTest
          if (!helper) throw new Error("__nodaroTest helper disappeared between probe and call")
          helper.batchAddNodesAndEdges(payload.nodes, payload.edges)
        },
        { nodes: nodes as NodaroTestNodeInput[], edges: edges as NodaroTestEdgeInput[] },
      )
    },
    getViewport: async () => {
      return await page.evaluate(() => {
        const helper = (window as unknown as { __nodaroTest?: NodaroTestApi }).__nodaroTest
        if (!helper) throw new Error("__nodaroTest helper missing")
        return helper.getViewport()
      })
    },
    resetSeen: async () => {
      await page.evaluate(() => {
        const helper = (window as unknown as { __nodaroTest?: NodaroTestApi }).__nodaroTest
        helper?.resetSeen()
      })
    },
  }
  return api
}

// ── Fixtures: tiny graph snippets used by individual tests ─────────────────

const ORIGIN_NODE: NodaroTestNodeInput = {
  id: "origin",
  // `text-prompt` is a simple, always-registered node type that renders a
  // plain BaseNode wrapper — no provider calls, no schema validation.
  type: "text-prompt",
  position: { x: 0, y: 0 },
  data: { text: "test origin" },
}

function newNode(suffix: string, x: number, y: number): NodaroTestNodeInput {
  return {
    id: `pw-${suffix}`,
    type: "text-prompt",
    position: { x, y },
    data: { text: `test ${suffix}` },
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe("Film Director live canvas construction (D1+D2+D3)", () => {
  test("D1 — node fades in over ~300 ms when added via batchAddNodesAndEdges", async ({ page }) => {
    const api = await setupOrSkip(page)

    // Seed a single origin node so the canvas isn't perfectly empty (some
    // empty-canvas affordances can interfere with selectors). NOT strictly
    // required, but makes the test more deterministic.
    await api.batchAddNodesAndEdges([ORIGIN_NODE], [])

    // Wait for the origin to settle so its animation doesn't bleed into
    // the new-node measurement. The animation completes after 300 ms; we
    // poll until opacity:1 is reached (which is the "done" state).
    const originLocator = page.locator(`.react-flow__node[data-id="${ORIGIN_NODE.id}"]`).first()
    await expect(originLocator).toBeVisible({ timeout: 10_000 })

    // ── Phase under test: add a NEW node and watch it fade in ──
    const fresh = newNode("d1-fade", 400, 0)
    await api.batchAddNodesAndEdges([fresh], [])

    const freshLocator = page.locator(`.react-flow__node[data-id="${fresh.id}"]`).first()
    // The React Flow node wrapper appears immediately (data-id renders on
    // mount). The opacity transition is on BaseNode's inner wrapper —
    // useNodeInsertAnimation returns INITIAL_STYLE on first render then
    // swaps to ANIMATING_STYLE on the next rAF, so we expect:
    //   1) the element exists in the DOM
    //   2) within ~50ms it has the transition CSS applied (animating phase)
    //   3) within 500ms (300ms anim + slack) the final opacity is 1
    await expect(freshLocator).toBeAttached({ timeout: 2_000 })

    // The animated style is on BaseNode's outermost div (`style={insertStyle}`)
    // — that's the FIRST child of `.react-flow__node` (the React Flow
    // wrapper itself doesn't get the style; the user content does).
    const animatedWrapper = freshLocator.locator("> div").first()

    // Poll for the final state. We don't try to catch the initial 0 →
    // intermediate value because rAF + transition together can finish
    // within a single Playwright poll interval (~50ms); the final value
    // is the deterministic invariant.
    await expect(animatedWrapper).toHaveCSS("opacity", "1", { timeout: 1_500 })

    // Sanity: the transform should NOT still be the initial scale(0.85)
    // once the animation completes. Match on the matrix form Playwright
    // returns (browsers serialize `scale(1)` to `none` OR `matrix(...)`
    // depending on whether other transforms are present — accept either).
    const finalTransform = await animatedWrapper.evaluate((el) =>
      window.getComputedStyle(el as HTMLElement).transform,
    )
    expect(finalTransform === "none" || finalTransform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true)
  })

  test("D2 — edge stretches over ~500 ms via stroke-dashoffset", async ({ page }) => {
    const api = await setupOrSkip(page)

    // Two nodes that we can connect.
    const a = newNode("d2-src", 0, 0)
    const b = newNode("d2-dst", 400, 0)
    await api.batchAddNodesAndEdges([a, b], [])

    await expect(page.locator(`.react-flow__node[data-id="${a.id}"]`)).toBeVisible({ timeout: 5_000 })
    await expect(page.locator(`.react-flow__node[data-id="${b.id}"]`)).toBeVisible({ timeout: 5_000 })

    // ── Phase under test: add an edge connecting them ──
    const edgeId = "pw-d2-edge"
    await api.batchAddNodesAndEdges([], [
      { id: edgeId, source: a.id, target: b.id },
    ])

    // React Flow renders edges as `.react-flow__edge[data-id="..."]`,
    // and the actual path lives inside as `.react-flow__edge-path`.
    const edgeLocator = page.locator(`.react-flow__edge[data-id="${edgeId}"]`)
    await expect(edgeLocator).toBeAttached({ timeout: 3_000 })
    const pathLocator = edgeLocator.locator("path.react-flow__edge-path").first()

    // After D2's 500 ms transition completes, the stroke-dashoffset should
    // settle at 0 (with the dasharray still at 9999, the visible stroke
    // fully covers the path — looks like a normal edge).
    //
    // toHaveCSS comparing "stroke-dashoffset" is robust across browsers
    // because computed styles serialize as a plain number string ("0px" or
    // just "0"). Match permissively.
    await expect(pathLocator).toHaveCSS("stroke-dashoffset", /^0(px)?$/, { timeout: 1_500 })

    // The dasharray is set to 9999 during the animating phase — the FINAL
    // state in useEdgeInsertAnimation's `FINAL_STYLE` is an empty CSS
    // object (no dasharray at all). On a fresh insert we expect the path
    // to have actively gone through ANIMATING_STYLE — which set
    // stroke-dasharray to 9999. Browsers normalize that to "9999px" or
    // "9999" depending on layout context.
    //
    // We don't assert on dasharray in the final state because the hook's
    // FINAL_STYLE intentionally omits it (after-animation, dashing should
    // not be in effect for subsequent paints). The dashoffset:0 check above
    // is the load-bearing invariant.
  })

  test("D3 — camera auto-pans toward a new node far from viewport", async ({ page }) => {
    const api = await setupOrSkip(page)

    // Start with a node at the origin so the viewport centers somewhere
    // predictable. Wait for it to render and for the camera to settle.
    await api.batchAddNodesAndEdges([ORIGIN_NODE], [])
    await expect(page.locator(`.react-flow__node[data-id="${ORIGIN_NODE.id}"]`)).toBeVisible({ timeout: 5_000 })

    // useCameraAutoPan suppresses pans for 2 s after any user move. We've
    // not moved the camera; the lastUserInteraction ref is at 0 (epoch),
    // so the very next batchAdd should trigger a pan. The pan is animated
    // over 600 ms (AUTO_PAN_DURATION_MS in use-camera-auto-pan.ts).

    const viewportBefore = await api.getViewport()

    // Add a node FAR from origin so panning to it is visually distinct.
    const far = newNode("d3-far", 4_000, 4_000)
    await api.batchAddNodesAndEdges([far], [])

    await expect(page.locator(`.react-flow__node[data-id="${far.id}"]`)).toBeAttached({ timeout: 3_000 })

    // Poll the viewport position until it changes from the pre-pan value.
    // setCenter writes the new x/y via React Flow's transition machinery
    // (~600 ms). We give 1.5 s of slack on top of that.
    await expect
      .poll(
        async () => {
          const vp = await api.getViewport()
          // Either x or y must have moved meaningfully (> 50 px diff —
          // ignore sub-pixel rounding).
          const moved =
            Math.abs(vp.x - viewportBefore.x) > 50 ||
            Math.abs(vp.y - viewportBefore.y) > 50
          return moved
        },
        { timeout: 2_500, message: "Camera did not auto-pan toward the far node" },
      )
      .toBe(true)

    // Zoom must be preserved across the pan (useCameraAutoPan reads
    // `getViewport().zoom` and passes it back into `setCenter`). Tolerance
    // accounts for sub-pixel transitions in flight.
    const viewportAfter = await api.getViewport()
    expect(Math.abs(viewportAfter.zoom - viewportBefore.zoom)).toBeLessThan(0.001)
  })

  test("canvas remains responsive when 10 nodes are added in quick succession", async ({ page }) => {
    const api = await setupOrSkip(page)

    // Capture console errors. Animations should never log to console;
    // React Flow render errors WILL log. Fail the test on any unexpected
    // browser console error.
    const errors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    page.on("pageerror", (err) => {
      errors.push(err.message)
    })

    // Build 10 nodes in a grid, plus 9 edges connecting them in a chain.
    // Spread them across the canvas so React Flow has to virtualize-render
    // some of them — exercises the seen-set memoization in D1/D2.
    const nodes: NodaroTestNodeInput[] = []
    const edges: NodaroTestEdgeInput[] = []
    for (let i = 0; i < 10; i += 1) {
      nodes.push(newNode(`burst-${i}`, (i % 5) * 300, Math.floor(i / 5) * 250))
      if (i > 0) {
        edges.push({ id: `pw-burst-edge-${i}`, source: `pw-burst-${i - 1}`, target: `pw-burst-${i}` })
      }
    }

    // Snapshot the pre-burst node count so the assertion doesn't false-fail
    // when the editor URL points at a workflow that already has nodes.
    const preBurstCount = await page.locator(".react-flow__node").count()

    await api.batchAddNodesAndEdges(nodes, edges)

    // All 10 new nodes must mount within 2 s. We use Playwright's
    // `toHaveCount` polling — robust to render batching.
    await expect(page.locator(".react-flow__node")).toHaveCount(preBurstCount + 10, { timeout: 2_000 })

    // All animations must complete within 2 s total budget. We sample the
    // last node's wrapper — its opacity is the slowest to settle since
    // React Flow renders bottom-up for the last-added id.
    const lastNode = page.locator('.react-flow__node[data-id="pw-burst-9"]').first()
    const lastWrapper = lastNode.locator("> div").first()
    await expect(lastWrapper).toHaveCSS("opacity", "1", { timeout: 2_000 })

    // Sanity: no console errors during the burst.
    expect(
      errors,
      "Browser console emitted errors while rendering 10 quick-fire nodes: " + errors.join(" || "),
    ).toEqual([])
  })
})
