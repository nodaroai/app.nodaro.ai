# Catalog Pack Seam — Design Note

**Date:** 2026-08-24
**Status:** Implemented (Phase 0)

## Summary

The picker catalogs (Setting, Mood, Person, Lens, …) ship as curated data in
`@nodaro/prompts`. A deployment sometimes needs to **curate** those catalogs —
drop options it never wants, add its own, or swap a catalog wholesale — without
forking or editing the upstream files (which makes every future upstream pull a
merge conflict).

The **catalog pack seam** makes curation *additive by registration*. A
deployment registers vendored **packs** at the picker-catalog composition root;
the base catalog arrays are never mutated in place. One composition funnel,
`getRegisteredPickerCatalogs()`, is what every enumerating consumer reads — the
per-picker API, the aggregate `/v1/catalogs` projection, the MCP catalog tools,
the prompt-hint fallback, and the completeness tests — so a registered pack is
reflected everywhere at once.

## The pack model

A `CatalogPack` targets **one existing catalog id** and applies one of three
modes:

| Mode | Meaning |
|------|---------|
| `replace` | Swap the whole catalog for a vendored copy. |
| `extend` | Append options (single-dim) or merge dimensions by field (multi-dim). |
| `deny` | Remove specific option ids from the catalog. |

`composePickerCatalogs(base, packs)` is a **pure** function: it deep-copies the
base and applies packs in registration order, so the base arrays are never
edited. Packs may only target a catalog id that already exists — minting a brand
new catalog id is out of scope for this phase (a new catalog drags the full
parameter-picker registration checklist). Registering a pack is the *only* way
to curate; there is no in-place edit path.

**Invariants (guarded by tests):**

- `PICKER_CATALOGS` (the upstream base) is frozen and byte-identical before and
  after any `replace` / `extend` / `deny` registration.
- Every registered catalog resolves and projects.
- Ratchet tests freeze the set of source files that still read the raw base
  arrays directly — one over `packages/prompts`, one over `packages/picker-ui`
  (plus the dedicated person-picker ratchet). The watched array names are derived
  from the funnel's own imports, and the allowlist may only shrink: a new
  raw-array importer fails, and a repointed file must be removed from the list.

## The composition funnel + deferred policy

`getRegisteredPickerCatalogs()` = `composePickerCatalogs(base, registeredPacks)`,
memoized on a pack-registry version counter so late registration is seen. It is
the single documented chokepoint. A future **catalog policy** (e.g. filtering by
tags, per-read-kind visibility) is deliberately **not built** in this phase; it
will plug in at exactly this funnel, after pack composition. The wire shape the
funnel projects to is intentionally tag-free and policy-free so nothing about a
future policy leaks across the public API boundary.

## `/v1/catalogs` — the server-driven projection

`GET /v1/catalogs?detail=compact|full` returns every registered catalog projected
to one flat, tag-free shape (`ProjectedCatalog[]`). It is the server-driven
counterpart to the per-picker `GET /v1/picker-catalogs/:nodeType`: a thin client
that renders its own pickers calls `/v1/catalogs` once and automatically honors
the deployment's registered packs, instead of shipping its own copy of the
catalogs. Read-only, public, cacheable. The SDK exposes it as
`client.catalogs.list()`.

## `nodaro catalog diff-upstream` — carrying upstream edits forward

Vendoring a pack means pinning a copy of upstream at a moment in time. When
upstream later edits an entry the deployment did **not** touch, that edit should
flow into the pack automatically; when the deployment *did* edit an entry that
upstream also changed, that is a conflict a human must resolve. The
`nodaro catalog` CLI is an **offline, file-based** three-way merge over JSON
snapshots (`diff-upstream`), plus `snapshot` and a sidecar `validate`:

- **carry** — entry unmodified by the deployment, changed upstream → adopt the
  upstream entry *and* its localized sidecar strings.
- **conflict** — entry modified by both → reported, pack kept (never
  overwritten).
- **new upstream** — entry new since vendoring → reported, **never
  auto-admitted** (adding options is always a deliberate act).
- **removed upstream** — entry gone upstream but still in the pack → reported.

Nothing is auto-admitted and nothing is silently overwritten; the tool produces
a plan, and a `--write` step stores the next baseline.

## Localization coverage for packs

A pack that adds options can carry per-locale **sidecar** translations and may
declare which locales it deliberately leaves untranslated
(`exemptSidecarLocales`). `computePackSidecarCoverage` reports, per pack, which
non-English locales are covered, which are declared-exempt, and which are
missing — so a pack's translation status is explicit rather than silently
English-only.

## Person extension packs

The Person picker is multi-dimensional (type, age, build, …). A **person pack**
adds a new person dimension with its own entries and rides the same seam: one
registration fans out to (a) a pack-aware person registry that repoints
`getPerson` / `getPersonPromptHint` / `buildPersonHints` to the registered set,
and (b) a derived generic catalog pack so the new dimension enumerates in
`/v1/catalogs`, localizes through the sidecar path, and composes its prompt
fragment at execution time. The person picker UI reads the registered person set
so a pack's entries appear in the editor. A neutral fixture
(`person-sector-pack`) exercises the whole path end to end: enumerate → project →
compose hint → report sidecar coverage.

## Phase-0 scope notes (named follow-ups)

- **Editor-component repoint.** ~38 picker-ui components (the picker widgets +
  the central registry) plus, on the prompts side, the describe-to-picker
  analyzer registry and picker-wiring still import the raw base arrays directly.
  `replace` / `deny` is already honored across the API, MCP, completeness, and
  hint funnels; repointing those components is mechanical and is fenced by the
  direct-import **ratchet guards** (one per consuming package) so the offender
  list can only shrink. The **person** UI path is repointed in this phase because
  a person pack's visibility depends on it.
- **Deferred catalog policy.** Tags, deny-by-tag, per-read-kind filtering — not
  built; the single plug-in point is the composition funnel above.
- **Person single-string field-mapping fallback.** The authoritative
  prompt-composition path (`buildPersonHints`) is pack-aware, so a person pack's
  dimensions compose correctly into prompts. The separate single-string
  field-mapping fallback for a `{Person}` reference is left untouched this phase:
  a person node configured with *only* a pack dimension returns `undefined` for
  that single-string reference. This is an accepted, scoped limitation tracked as
  a future data-driven person value-field registry.
