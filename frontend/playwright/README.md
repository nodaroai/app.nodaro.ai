# Playwright tests — Nodaro frontend

End-to-end / visual-regression tests for the workflow editor canvas. Bootstrapped as part of Task D4 of the Film Director skill (see `specs/features/2026-05-14-nodaro-film-director-implementation-plan.md`).

## Layout

```
frontend/
  playwright.config.ts          # config (single chromium project, no auto dev server)
  playwright/
    README.md                   # this file
    tests/
      film-director-canvas-build.spec.ts   # D1+D2+D3 visual regression
```

Tests run against an already-running dev pair — Playwright does NOT start the servers itself:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev

# Terminal 3
cd frontend
npx playwright test playwright/tests/film-director-canvas-build.spec.ts
```

To list discovered tests without running them:

```bash
cd frontend
npx playwright test --list
```

## Auth strategy

The editor lives behind `DashboardLayout`, which redirects unauthenticated traffic to `/login`. Playwright must therefore inject a Supabase session into `localStorage` BEFORE the first paint, or every test in the suite is rerouted away from the editor and the spec self-skips.

We support two paths. **Option A is the default and the only one that ships today.** Option B is documented for future CI integration.

### Option A (default) — paste a Supabase session JSON env var

The operator copies a logged-in browser's Supabase session string out of `localStorage` and exports it before running Playwright. The spec's `installSupabaseSession` helper reads the env var and injects it via `page.addInitScript`.

**Step-by-step:**

1. Log in to the local dev frontend (`http://localhost:5173`) with a real test account in a regular browser window.
2. Open DevTools → Application → Local Storage → `http://localhost:5173`.
3. Locate the key shaped like `sb-<project-ref>-auth-token` (the `<project-ref>` is the Supabase project ref pulled from `VITE_SUPABASE_URL`). Copy the entire JSON value.
4. Locate (or create) a target workflow you want the spec to drive. Copy its editor URL — it'll look like `http://localhost:5173/projects/<projectId>/workflows/<workflowId>`. An empty (or near-empty) workflow is best so the spec's assertions don't fight existing nodes.
5. Export both into your shell before running Playwright:

   ```bash
   export PLAYWRIGHT_SUPABASE_SESSION_JSON='<paste-the-json-value-here>'
   export PLAYWRIGHT_EDITOR_URL='http://localhost:5173/projects/<projectId>/workflows/<workflowId>'

   # Optional: only set this if your local Supabase storage key is non-standard.
   # The spec defaults to `sb-<ref>-auth-token` derived from VITE_SUPABASE_URL.
   # export PLAYWRIGHT_SUPABASE_STORAGE_KEY='sb-<custom-ref>-auth-token'

   npx playwright test playwright/tests/film-director-canvas-build.spec.ts
   ```

6. When the session expires (Supabase sessions are typically hours-to-days), the spec will auto-skip because the editor redirects to `/login`. Repeat steps 1–3 to re-capture.

**Pros**

- Zero fixture code — the spec is self-contained.
- No service-role key on the test runner.
- Works against any environment (local, staging) by switching one env var.

**Cons**

- Manual recapture on session expiry — not viable for headless CI.
- Tied to a single test account; cannot easily exercise multi-user scenarios.

### Option B (future, deferred) — mint a Supabase JWT from the service-role key

For headless CI we will eventually replace the session-JSON env var with a Playwright fixture that mints a short-lived Supabase JWT at test setup using `SUPABASE_SERVICE_ROLE_KEY`. The minted JWT gets injected via the same `page.addInitScript` path, so the in-spec assertions don't change.

**Sketch (NOT yet implemented):**

```typescript
// frontend/playwright/fixtures/supabase-auth.ts (future)
import { test as base } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

export const test = base.extend({
  authedPage: async ({ page }, use) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: process.env.PLAYWRIGHT_TEST_USER_EMAIL!,
    })
    // ...exchange the link for a session, set localStorage, return page...
  },
})
```

**Pros**

- Works headless in CI with no human in the loop.
- No expiry concerns — every test run mints a fresh token.
- Can parametrize over multiple test users.

**Cons**

- Service-role key exposed to the test runner — must live in CI secret store, never `.env.local`.
- ~50 lines of fixture code to maintain.
- Requires a dedicated CI-only test account with stable data.

**Why we deferred it:** the dev → main staging pipeline doesn't run Playwright yet, and Option A covers all local-dev needs today. Once CI integration is scoped (the trigger will be a green light to run regression on every PR), open a follow-up ticket to land the fixture and rotate `PLAYWRIGHT_SUPABASE_SESSION_JSON` out of any contributor docs.

## Spec-level prereqs

Each spec under `tests/` has a self-skip guard at the top — if its env vars are missing, the entire file is skipped with a descriptive message rather than failing. This lets us land specs before the test infra is fully wired.

For `film-director-canvas-build.spec.ts` the prereqs are:

- `PLAYWRIGHT_EDITOR_URL` — the workflow editor URL to navigate to (see Option A step 4 above).
- `PLAYWRIGHT_SUPABASE_SESSION_JSON` — the Supabase session JSON (see Option A step 3 above).
- `window.__nodaroTest` — a dev-only helper mounted by `WorkflowCanvas` (see `frontend/src/components/editor/workflow-canvas.tsx`). Gated by `import.meta.env.DEV`, so it's only available against `npm run dev` — never against a production build.
