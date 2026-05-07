---
title: Contributing
layout: default
---

# Contributing to Nodaro

Thanks for your interest in contributing. Nodaro is a source-available
AI workflow editor — under the [Sustainable Use License](../LICENSE),
anyone can run their own copy for personal or internal-business use,
build apps on top of the REST API, or send patches upstream. This
document is the entry point for the third group: people who want to
land code in this repo.

If you instead want to *use* Nodaro on your own server, start at the
[Community Edition Quickstart](./community-edition-quickstart.md). For
building integrations against the API, see
[API Integration](./api-integration.md) and the
[SDK Quickstart](./sdk-quickstart.md).

## 1. Project layout

The repo is a single npm workspaces monorepo. Top-level folders:

| Path | What lives here |
|------|-----------------|
| `backend/` | Fastify HTTP API, BullMQ workers, orchestrator. Node 22, TypeScript. |
| `frontend/` | Vite SPA — visual editor + presentation/app-runner + admin panel. React 19, React Router 7, React Flow. |
| `packages/shared/` | Pure logic shared across the stack: types, model registries, prompt builders. Publishes as [`@nodaro/shared`](https://www.npmjs.com/package/@nodaro/shared). |
| `packages/client/` | Typed REST SDK with three auth modes and seven resource classes. Publishes as [`@nodaro/client`](https://www.npmjs.com/package/@nodaro/client). |
| `packages/remotion/` | Remotion video compositions (slideshow, scene-graph, motion-graphics, etc.). |
| `supabase/migrations/` | Database schema as forward-only SQL migrations. |
| `docs/` | Public docs — this folder is published to GitHub Pages. |
***REDACTED-OSS-SCRUB***
| `scripts/` | Repo-level utilities (architecture graph generator, audits, etc.). |
| `.changeset/` | Pending version-bump intents for `@nodaro/shared` + `@nodaro/client`. |

The root `CLAUDE.md` is the canonical "house rules" file — coding
standards, the Provider Enum Sync checklist, and the New Node
Registration checklist all live there. Always read it before a
non-trivial PR.

## 2. Dev environment setup

### Prerequisites

```bash
node --version    # 22 or newer
npm --version     # ships with Node
```

### Install

```bash
git clone https://github.com/nodaroai/app.nodaro.ai
cd app.nodaro.ai

# Single command — installs every workspace
npm install
```

### Configure secrets

```bash
cp .env.example .env
# Edit .env — at minimum:
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#   SUPABASE_ANON_KEY
#   INTERNAL_ORCHESTRATOR_SECRET (any 32-byte hex)
#   At least one AI provider key (KIE_API_KEY / REPLICATE_API_TOKEN / ANTHROPIC_API_KEY)
```

Generate the orchestrator secret in one line:

```bash
echo "INTERNAL_ORCHESTRATOR_SECRET=$(openssl rand -hex 32)" >> .env
echo "SOCIAL_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
```

The full list of supported variables is in `.env.example`. The
[Community Edition Quickstart](./community-edition-quickstart.md) has
the full setup flow including Supabase project creation.

### Build the shared package

The frontend resolves `@nodaro/shared` from the package's `dist/`
output, so you have to build it once before starting the dev server.
After that, `tsup --watch` (run via the package's own dev script)
keeps it up to date if you edit shared code.

```bash
npm -w @nodaro/shared run build
```

### Run the dev servers

In two terminals:

```bash
# Terminal 1 — backend on :9000
cd backend
npm run dev

# Terminal 2 — frontend on :3000 (proxies /v1/* to :9000)
cd frontend
npm run dev
```

For Supabase: the easiest path is creating a free project on
[supabase.com](https://supabase.com) and pointing your `.env` at it.
A fully local stack is possible via the Supabase CLI (`supabase start`)
but is more involved — see the Supabase docs.

## 3. Coding standards

The canonical reference is `CLAUDE.md` at the repo root. The most
frequently cited rules:

- **File size**: 200–400 lines is typical, 800 is the hard ceiling.
  If a file gets bigger, split it.
- **No `console.log` in production code.** Use the existing logger
  patterns in the codebase.
- **Conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`,
  `chore:`, `test:`. Be specific in the subject line.
- **Type-check before every commit**: `npx tsc --noEmit` in both
  `backend/` and `frontend/`. PRs that don't type-check are blocked
  by CI.
- **Backend uses Fastify plugin pattern**, not Express Router.
  Every route file exports an async function that takes a `FastifyInstance`.
- **Every backend endpoint has a Zod schema.** No exceptions. The
  schema is the source of truth for validation, and it doubles as the
  OpenAPI spec via `fastify-zod-openapi`.
- **Frontend state**: React Query for server state, Zustand for UI
  state, React Flow for canvas state. Don't mix concerns.
- **Never mutate** objects or arrays — always create new copies.
  Both Zustand and React Flow rely on referential equality.
- **Provider Enum Sync (CRITICAL)**: when you add or remove a
  provider for any node type, you must update *all 12 files* listed
  in the Provider Enum Sync table in `CLAUDE.md`. Forgetting step 3
  (the Zod enum) has caused the same validation bug three times.

## 4. Branching and PRs

- The repo has two long-lived branches: `dev` (staging) and `main`
  (production).
- Feature branches always **branch from `dev`** and PR back to `dev`.
  Never branch from or commit to `main` directly.
- Branch naming: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`,
  `test/`. Example: `feat/whisper-tts-node`.
- After your PR is merged, Railway automatically deploys `dev` to
  the staging instance at `next.nodaro.ai`. Try your change there.
- After ~24h staging soak, a maintainer opens a PR from `dev` to
  `main`. This must be a **regular merge**, never a squash —
  squashing causes `dev` to diverge from `main` and breaks
  Supabase migration application.

When opening a PR:

- Reference any related GitHub issue in the body.
- Include screenshots / GIFs for UI changes.
- If the change adds or modifies a node, follow the New Node
  Registration checklist (see section 6 below).
- If the change touches `@nodaro/shared` or `@nodaro/client`, run
  `npx changeset` and commit the generated file (see section 8).

## 5. Testing

Each workspace ships its own Vitest suite. The full suite runs from
the repo root:

```bash
npm test                       # runs every workspace's "test" script
```

Or per workspace:

```bash
npm -w @nodaro/shared test     # pure-logic unit tests
npm -w @nodaro/client test     # SDK contract tests against MSW
cd backend && npm test          # route + service tests
cd frontend && npm test         # component + hook tests
```

What to test:

- **Backend routes** — golden path plus the edge cases your Zod
  schema enumerates. Mock Supabase via `vi.mock("@/lib/supabase")`;
  most existing tests have a copy-pasteable setup. Mock external
  AI providers; never hit the real KIE/Replicate APIs in a unit
  test.
- **Frontend components** — react-testing-library smoke tests.
  Heavy logic should live in hooks (`frontend/src/hooks/`) or
  helpers (`frontend/src/lib/`) where it can be unit-tested in
  isolation. Avoid testing implementation details of React Flow or
  Zustand stores directly.
- **Shared package** — pure-function unit tests. The package
  exports must remain serializable across the frontend ↔ backend
  boundary.

CI runs `tsc --noEmit`, `vitest`, and a small linting pass. Local
flakiness is rare; if a test fails locally but passes in CI (or
vice versa), open an issue with reproduction steps.

## 6. Adding a new node

Adding a new node type touches a *lot* of files — backend route,
frontend component, executor wiring, registries — and skipping any
one of them produces a confusing failure mode (the node doesn't
appear in the sidebar, or the Run button silently does nothing, or
the orchestrator can't resolve inputs). The canonical 19-step
checklist is in `CLAUDE.md` under "New Node Registration".

The high-level shape of a new node:

- One backend route file in `backend/src/routes/<node-type>.ts`
  with a Zod schema, a credit guard, and the actual provider call.
- One frontend node component in
  `frontend/src/components/nodes/<node>-node.tsx` and a config
  panel in `frontend/src/components/editor/config-panels/`.
- Updates to a handful of registries: `nodeTypes` map, the popup
  list, the sidebar list (these are *separate* — easy to miss
  one), the executor switch in `execute-node.ts`, and the
  `EXECUTABLE_NODE_TYPES` set.
- A new `NODE_REGISTRY` entry so the node shows up in
  `GET /v1/nodes` (the discovery endpoint used by `@nodaro/client`).

Two unintuitive details that bite contributors:

- **The popup list and the sidebar list are different.** Adding to
  one without the other means your node only appears in half the
  UI. Steps 8 and 9 in the `CLAUDE.md` checklist.
- **`EXECUTABLE_NODE_TYPES` is opt-in.** Without an entry there,
  your node renders fine but the Run button can't fire it.

There's a more detailed walkthrough in
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
actually stays in sync.

## 7. Adding a new AI provider

Adding a provider to an existing node type (e.g. a new image-gen
model) is *not* the same as adding a new node. The checklist is
shorter — 12 files — and lives in `CLAUDE.md` under "Provider Enum
Sync". The headline gotchas:

- The Zod enum on the backend route (step 3) is the most commonly
  forgotten file. The frontend will happily render an option that
  the backend rejects with a 400.
- The seed migration (step 9) — without a row in `model_pricing`,
  the model is invisible in the admin UI even though
  `STATIC_CREDIT_COSTS` charges correctly at runtime.
- For image and video providers, the per-provider param routing in
  `model-options.ts` matters. Different providers expect
  `aspect_ratio` vs `image_size`, native `negative_prompt` vs an
  appended "Avoid: …", etc. Read the existing entries before
  adding a new one.

For node types that use provider-aware dropdowns (resolution,
quality, voice), make sure the config panel includes the fail-safe
`useEffect([currentProvider])` from step 12b — this snaps stale
data values to the first valid option when the user switches
providers, otherwise persisted workflows trip the route's Zod enum.

## 8. Releasing the SDK packages

Two packages in `packages/` publish to npm: `@nodaro/shared` and
`@nodaro/client`. The release flow is [Changesets](https://github.com/changesets/changesets):

```bash
# After making a change that affects either package
npx changeset
```

The CLI prompts you to pick which packages changed, the bump type
(patch / minor / major), and a one-line summary. It writes a
markdown file under `.changeset/<random>.md` — commit this with
your PR.

When the PR merges to `dev` and ultimately `main`, a maintainer
runs:

```bash
npm run version    # bumps versions, updates CHANGELOG.md
npm run release    # builds + publishes to npm
```

You don't need to publish anything yourself — the changeset is the
only thing the contribution flow asks for. If your PR doesn't
touch the published packages (`@nodaro/shared` or `@nodaro/client`),
no changeset is needed; the workspaces under `ignore` in
`.changeset/config.json` are skipped.

## 9. Code of conduct

Be kind. Be respectful. Assume good faith. We follow the
[Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) —
read it once if you haven't. Harassment of any kind is grounds for
removal from the project.

In practice this means:

- Critique code, not people.
- Disagree without being rude. "I think pattern X would be cleaner
  here because Y" is great; "this is bad" is not.
- If you're a maintainer reviewing a first-time contributor, be
  patient. Onboarding is a long-tail investment.

## 10. Where to ask questions

- **GitHub Issues** — bug reports, feature requests, security
  reports (use a private advisory for security).
- **GitHub Discussions** — open-ended questions, ideas, "hey I
  built this with Nodaro" show-and-tell. Use this in preference to
  Issues for non-bug questions.
- **Avoid emailing maintainers privately** for project questions —
  Issues and Discussions are public so others learn from the
  answer too. Private contact is fine for security reports or
  conflict-of-interest situations.

## 11. License

Nodaro is fair-code with three license tiers (see [`LICENSE.md`](../LICENSE.md)
for the full overview):

- Community code (default): [Sustainable Use License](../LICENSE) —
  source-available; permits personal + internal-business use +
  self-hosting; prohibits commercial hosted-service offerings to third
  parties.
- Enterprise code (any path with an `ee` segment, any filename
  containing `.ee.`, plus compiled artifacts derived from such files):
  [Enterprise License](../backend/src/ee/LICENSE) —
  same terms plus a paid subscription requirement for production use,
  with carve-outs for development, testing, and evaluation.
- SDK packages (`packages/client/`, `packages/shared/`):
  [Apache License 2.0](../packages/shared/LICENSE) — embed in
  commercial applications freely.

By submitting a contribution, you agree to the [Nodaro Contributor
License Agreement](../CLA.md). The same CLA covers individual and
corporate contributions — Section 2 handles employer-permission. The
cla-assistant bot will prompt for signature automatically on your
first pull request.

If you're contributing on behalf of an employer, double-check that
your employer's IP policy allows you to do so before signing.
Contributions to `ee/` directories or `*.ee.{ext}` files are subject
to the Enterprise License; the CLA grants Nodaro the right to relicense
all contributions across the full dual-licensing model.

---

Thanks for reading this far. The fastest path to a merged PR is:
read `CLAUDE.md`, pick a small first change, open a draft PR
early, and ask questions in Discussions when you're stuck. We're
glad you're here.
