# Community Sharing — Characters, Locations & Objects (Admin-Curated v1)

**Status:** Design (approved)
**Scope:** **Admins publish** characters, locations, and objects into a curated shared library; **any logged-in user browses and clones** them into their own library as independent copies.

> **v4 scope change: only admins can share.** Publishing is admin-only (`requireAdmin`); browse + clone are for all logged-in users. This is a deliberate v1 limit — self-serve user publishing is a future expansion. With admin-only publishing there is no self-serve consent flow, no anonymous public surface, and no `gen:skills` coupling.

---

## 1. Goal

An **admin** publishes a character/location/object into the shared library (a curated snapshot). Any **logged-in user** browses the library, previews an item (curated images), and **clones** it into their own library as an independent, editable copy. "Use as-is" and "clone" are the same operation — copy into my library — differing only in whether the user then edits it.

The full clonable payload (assets + canonical text "recipe") lives in a **protected snapshot** read only server-side at clone time; browse/detail expose a curated image subset, so the recipe isn't bulk-harvestable.

## 2. Decisions locked

| # | Decision | Choice |
|---|----------|--------|
| D1 | Consume model | **Snapshot copy (independent)** — copy row + copy assets to fresh keys; a clone never breaks if the publisher edits/removes the original, and a listing survives deletion of its source. |
| D2 | **Who can share** | **Admins only** (`requireAdmin`, per-user `role IN ('admin','super_admin')`). Browse/clone/favorite/report: any logged-in user. |
| D3 | Edition + placement | **Business + Cloud** (admins exist only there; Community is single-user). Sharing code under `ee/`, gated by `isMultiUser()` (`= !isCommunity()`). |
| D4 | Data model | `community_listings` (browsable) + protected `community_listing_snapshots` + favorites/reports/clones, plus a per-entity **adapter registry**. |
| D5 | Discovery surface | One `/explore` dashboard page, **authenticated**, tabs Characters · Locations · Objects. |
| D6 | Likeness / consent | Admin records an attestation at publish ("rights/consent of any real person depicted; 18+"). Users can **report** ("depicts a real person without consent" + other reasons); admins take down. (Trusted-publisher model → no self-serve consent gymnastics; the type-keyed spoof concern is moot.) |
| D7 | Listing cardinality | **One listing per source** — plain `UNIQUE(source_id)` (NULLs distinct, so deleted-source orphans coexist; clean `ON CONFLICT` arbiter — NOT a partial index, cf. migration 166). |
| D8 | Visibility | Browse/detail require a **logged-in session** (no anonymous/public access in v1 → no public-route whitelist, no anon column exposure). |
| D9 | Storage | Quota/accounting is a **Cloud-only (`hasCredits()`) feature** (Business has no quota for any asset — existing product behavior). Clone reserves against the cloner; publish accounts against the publishing admin; both no-op safely in Business. |

## 3. Snapshot copy & asset lifecycle

Entity images are denormalized **public R2 CDN URLs** in JSONB columns. Independence at two hops, via server-side R2 `CopyObject`:

1. **Publish-time copy** (admin) → public-safe blobs copied to a stable `community/<listing_id>/…` prefix; snapshot stores those URLs. Survives deletion of the admin's private original.
2. **Clone-time copy** (user) → snapshot's community blobs copied to the cloner's space under **fresh keys** (never shared across users); new private row points at the cloner's copies.

**Ordering** (mirror `workflow-templates.ts:515-548`): NEW publish → app-side `const listingId = randomUUID()` → copy blobs → build snapshot → publish RPC with that id. RE-publish → look up the listing by `source_id`, **reuse its id**, `purgeCommunityListingBlobs(id)` (refunds old bytes, see below) **before** re-copying.

**Copy helper:** generalize the existing `storage.ts::copyToTemplatePreview` (R2→R2 `CopyObjectCommand` + foreign-URL fallback + storage tracking) into `copyR2ObjectToPrefix(...)`. Do not create a new `lib/r2.ts`.

**Prefix-purge primitive (single source of truth).** Add to `storage.ts`:
- `listObjectsByPrefix(prefix)` via `ListObjectsV2Command` — **must loop on `NextContinuationToken`** (ListObjectsV2 caps at 1000 keys/page; un-paged = silent under-delete). `ListObjectsV2Command` is **not yet imported** in `storage.ts` (the SDK is, the command isn't) — add it to the import.
- `purgeCommunityListingBlobs(listingId)` — **idempotent refund via CAS**: (1) `UPDATE community_listings SET r2_assets_purged_at = now() WHERE id=$1 AND r2_assets_purged_at IS NULL RETURNING published_bytes` → if 0 rows, already purged, return; (2) `listObjectsByPrefix("community/<id>/")` (trailing slash — UUIDs are fixed-length so no prefix-collision) → `batchDeleteFromR2`; (3) `refundStorage(creator_id, published_bytes)` (Cloud-only no-op otherwise). Used by unpublish, admin takedown, and re-publish; re-publish then resets `r2_assets_purged_at = NULL` when it re-copies.

**Reaper.** The cleanup-cron is Cloud-only (`hasCredits()`) and never scans `community/`, so we own reaping:
- Synchronous `purgeCommunityListingBlobs` on unpublish/takedown and before re-publish re-copy.
- A backstop sweep (`ee/services/community/reaper.ts`, modeled on `sweepSoftDeletedLocationAssets`): find `is_active=false` listings past a grace window → purge → hard-delete listing+snapshot rows. **Started in `server.ts` under `isMultiUser()`** via a plain `setInterval` (mirror the already-ungated `startScheduleCron`; runs in dev too, with its own grace-window env, so §13 can exercise it).

## 4. Non-goals (v1)

Self-serve user publishing (admin-only for now) · monetization · ratings · listing version history · cross-instance federation · bulk publish · live (non-snapshot) references · MCP community tools · anonymous/public browse. Clone provenance IS in scope (`community_clones`).

## 5. Edition, licensing & registration

- **`isMultiUser()`** in `backend/src/lib/config.ts` + `frontend/src/lib/edition.ts` = `!isCommunity()`. Reuses `EDITION`/`VITE_EDITION` — no Dockerfile change. Core placement.
- **Backend → `backend/src/ee/`:** `ee/routes/community.ts` (user-facing: browse/detail/clone/favorite/report), `ee/routes/admin-community.ts` (admin: publish/patch/unpublish/takedown/reports — `requireAdmin`), `ee/services/community/` (publish, clone, snapshot, asset-copy, reaper), `ee/lib/community-entity-adapters.ts`. Registered in `app.ts` (allowlisted importer) under `if (isMultiUser())`.
- **Frontend → `frontend/src/ee/`:** `/explore` page, image-grid preview/clone modal; admin publish dialog + reports queue under `ee/app/(admin)/`. Routes via the `isMultiUser() ? [...] : []` conditional-spread into `DashboardLayout.children` (mirror `router.tsx:91` adminRoutes, using `SuspenseWrapper`); admin publish UI additionally gated by `hasAdmin()`/role. Core never statically imports ee pages (the import-checker scans `frontend/src` and blocks static `@/ee`, incl. `import type`).
- **No public-route whitelist** (D8 — all community routes require a session). Browse/detail are session-gated like the rest of the app.
- **Migration:** `supabase/migrations/201_community_sharing.sql` (plain `.sql`; license header comment; current max = 200).
- `tools/check-ee-imports.mjs` stays green.

## 6. Data model

`201_community_sharing.sql`. User FKs → `profiles(id)` (consistent with entity tables; `auth.uid()` = `profiles.id`). All new functions **`SECURITY DEFINER … SET search_path = public`** (per migrations 194/196 — do NOT mirror template 076's unhardened versions).

### 6.1 `community_listings`

`id` uuid PK (app-pre-generated) · `entity_type` text `CHECK IN ('character','location','object')` · `source_id` uuid NULL FK `ON DELETE SET NULL`, plain `UNIQUE(source_id)` · `creator_id` uuid FK (publishing admin) · `creator_display_name` text · `slug` text UNIQUE (`generateSlug`=`base-random6`; uniqueness via insert-retry-on-`23505`) · `title`/`description` text (admin-authored; description ≠ entity `canonical_description`) · `category`/`style` text · `tags` text[] (GIN) · `preview_media_url` text (defaults to entity `main_image_url`/`source_image_url`) · `preview_images` jsonb (curated copied shots, entity-aware count) · `clone_count`/`favorite_count` int (clone via atomic RPC, favorite via trigger) · `is_listed` boolean DEFAULT true · `is_active` boolean DEFAULT true · `attestation_at` timestamptz NOT NULL · `likeness_attestation_at` timestamptz NULL (DB `CHECK (entity_type <> 'character' OR likeness_attestation_at IS NOT NULL)`) · `published_bytes` bigint DEFAULT 0 · `r2_assets_purged_at` timestamptz NULL · `search_vector` tsvector GENERATED using **`immutable_array_to_string(tags,' ')`** (migration 062 — stdlib `array_to_string` is non-IMMUTABLE and fails generated-column creation) · `created_at`/`updated_at` (PATCH/re-snapshot **must** bump `updated_at`).

Indexes: `(entity_type, is_listed, is_active, created_at DESC)`; GIN(`tags`), GIN(`search_vector`); `UNIQUE(source_id)`.

**Route projection:** browse/detail SELECT only public columns (`selectCols` discipline) — omit `source_id`, `attestation_at`, `likeness_attestation_at`, `published_bytes`, `r2_assets_purged_at`.

### 6.2 `community_listing_snapshots` (protected)

`listing_id` uuid PK FK ON DELETE CASCADE · `snapshot` jsonb (full clonable payload: all `assetFields` URLs + `canonical_description` + `seed_prompt` + `personality` + public text). **RLS enabled, NO SELECT policy** → deny-by-default; only the service-role client reads it (at clone) / writes it (at publish). No user-JWT reader, so no SELECT policy needed.

### 6.3 `community_listing_favorites`

`id`, `user_id` FK, `listing_id` FK ON DELETE CASCADE, `created_at`, `UNIQUE(user_id, listing_id)`. A `SECURITY DEFINER … SET search_path=public` trigger maintains `favorite_count`.

### 6.4 `community_listing_reports`

`id`, `listing_id` FK ON DELETE CASCADE, `reporter_id` FK, `reason` text `CHECK` (`'real_person_no_consent'`,`'inappropriate'`,`'ip_violation'`,`'other'`), `created_at`, `resolved_at` NULL, `resolved_by` NULL. Partial `UNIQUE(listing_id, reporter_id) WHERE resolved_at IS NULL`. Rate-limited at the route.

### 6.5 `community_clones` (provenance)

`id`, `listing_id` FK, `user_id` FK, `entity_type`, `new_entity_id` uuid, `created_at`. Indexes `(user_id, listing_id)` + `(listing_id)`. No UNIQUE (re-clone is legitimate). Written with the `clone_count` bump by one RPC (§6.6).

### 6.6 RLS & functions

```sql
-- Authenticated users read active listings (auth.uid() IS NOT NULL blocks anon even via direct PostgREST)
CREATE POLICY "Authed read active listings" ON community_listings
  FOR SELECT USING (is_active = true AND auth.uid() IS NOT NULL);
CREATE POLICY "Admins manage listings" ON community_listings
  FOR ALL USING (is_admin());
ALTER TABLE community_listing_snapshots ENABLE ROW LEVEL SECURITY; -- no SELECT policy (service-role only)
CREATE POLICY "Users manage own favorites" ON community_listing_favorites FOR ALL USING (user_id = auth.uid());
CREATE POLICY "Users file reports" ON community_listing_reports FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "Admins read reports" ON community_listing_reports FOR SELECT USING (is_admin());
CREATE POLICY "Users read own clones" ON community_clones FOR SELECT USING (user_id = auth.uid());
```

Functions (all `SECURITY DEFINER … SET search_path = public`; mutating paths run via the service-role client which bypasses RLS, with app-layer `requireAdmin`/ownership checks):
- **`publish_community_listing(p_id, p_source_id, …, p_likeness_attestation_at, p_published_bytes, p_snapshot)`** — one transaction (a PL/pgSQL body is atomic; precedent `173_app_monetization_idempotent.sql`): `INSERT INTO community_listings (…) VALUES (…) ON CONFLICT (source_id) DO UPDATE SET is_active=true, is_listed=true, …, likeness_attestation_at = COALESCE(EXCLUDED.likeness_attestation_at, community_listings.likeness_attestation_at), attestation_at = COALESCE(community_listings.attestation_at, now()), published_bytes = EXCLUDED.published_bytes, r2_assets_purged_at = NULL, updated_at = now() WHERE community_listings.creator_id = p_creator_id RETURNING id, slug`; then `INSERT INTO community_listing_snapshots (listing_id, snapshot) VALUES (id, p_snapshot) ON CONFLICT (listing_id) DO UPDATE SET snapshot = EXCLUDED.snapshot`. (Plain `UNIQUE(source_id)` is a valid `ON CONFLICT` arbiter; the `COALESCE` keeps a character's `likeness_attestation_at` non-null across re-publish so the CHECK never trips; the `creator_id` guard is defense-in-depth.) No takedown-reactivation guard needed (admin-only publishers, D6).
- **`record_clone(listing_id, user_id, entity_type, new_entity_id)`** — atomically inserts `community_clones` + `clone_count = clone_count + 1`; returns new count (single writer of `clone_count`; no drift).
- favorite-count trigger (above).

`is_admin()` (SECURITY DEFINER, migration 019) confirmed present.

## 7. Entity adapter registry

`backend/src/ee/lib/community-entity-adapters.ts` — `{ table, publicTextFields, assetFields, stripFields, buildSnapshot(row), buildCloneRow(snapshot, ctx) }`.

| | Character | Location | Object |
|---|---|---|---|
| **Public text** | name, description, gender, base_outfit, style, canonical_description, seed_prompt, personality | name, description, category, style, canonical_description, style_lock | name, description, category, style, canonical_description, style_lock |
| **Copied assets** | source_image_url, character_sheet *(object shape)*, expressions, poses, lighting_variations, angles, body_angles, motions | **main_image_url**, source_image_url, time_of_day, weather, angles, lighting, seasons, atmosphere_motions | **main_image_url**, source_image_url, angles, materials, variations, motion_clips |
| **Stripped — PII** | reference_photos, real_life_refs_by_variant, reference_videos_by_variant | reference_photos (not pii_consent_at) | reference_photos |
| **Stripped — ownership/legacy** | `voice` unless `voice.voiceType === "premade"`; all 7 `lora_*` cols | `custom_variations` (deprecated) | `custom_variations` (deprecated) |

Notes: `main_image_url` (approved hero) exists on locations/objects — copy it, default `preview_media_url` to it; `character_sheet` is an object (handle both shapes); characters have no `pii_consent_at`. `buildCloneRow` writes via service-role, sets `user_id` + a valid owned `project_id` via **`ensureDefaultProject(userId)`** (the helper, not the `auth.uid()`-bound RPC; a null `project_id` fails the project-based `characters` RLS on the cloner's JWT re-read). Asset writes go direct through the service-role client (migration 200 locked only the `append_character_asset` PostgREST RPC for non-service callers). Shared **`backend/src/lib/entity-naming.ts::deriveAvailableName(table, userId, baseName)`** (extract from `characters.ts`; locations/objects have none). When `source_id IS NULL` (admin deleted the source), the listing is frozen: re-snapshot returns a typed "source deleted" error; it remains clonable.

## 8. Backend API

`requireAdmin` = per-user admin role (mirror `admin-gallery-reports.ts`). Async scope/admin preHandlers **must `return reply.send(...)`** to halt.

**Admin routes** (`ee/routes/admin-community.ts`, `requireAdmin`):
| Method + path | Behaviour |
|---|---|
| `POST /v1/admin/community/:entityType/:id/publish` | Requires `attestation:true` (+ `likenessAttestation:true` for characters). Verifies admin owns the source (or allow any admin to publish library content — see note). RE-publish: lookup id by `source_id`, `purgeCommunityListingBlobs` old, re-copy. Copies public-safe assets → `community/<id>/…` (sum `published_bytes`), curates `preview_images`, calls `publish_community_listing`. Returns `{ slug }`. |
| `PATCH /v1/admin/community/listings/:id` | Edit title/description/category/tags/`is_listed`; or re-snapshot (purge old prefix, bump `updated_at`). Errors if `source_id IS NULL`. |
| `DELETE /v1/admin/community/listings/:id` | Unpublish: `is_active=false` + synchronous `purgeCommunityListingBlobs`. |
| `GET /v1/admin/community/reports` · `…/count` · `PATCH …/:reportId` · `POST …/listings/:id/takedown` | Reports queue (real-person reports fast-tracked) + takedown (`is_active=false` + purge, idempotent CAS). Model on `admin-gallery-reports.ts`. |

> Note: "admin owns the source" vs "any admin can publish any admin's source" — v1 default: an admin publishes their **own** entities (the publish RPC's `creator_id` guard enforces this). Cross-admin publishing isn't needed in v1.

**User routes** (`ee/routes/community.ts`, session required; gated `isMultiUser()`):
| Method + path | Auth | Behaviour |
|---|---|---|
| `GET /v1/community/browse` | session | `entityType,q,category,style,sort,cursor,limit`. Public projection only. Filters `is_listed && is_active`. **Cursor** = base64-encoded `{count,createdAt,id}` JSON (avoids the colon-in-timestamp parse trap; `id` is the total-order tie-breaker on all sorts). |
| `GET /v1/community/detail/:slug` | session | Public projection + `preview_images`. No snapshot/canonical text. |
| `GET /v1/community/favorites` | session | User's favorited listings. |
| `POST /v1/community/listings/:id/clone` | session + `assets:write` | `reserveStorageIfWithinLimit(cloner)` (Cloud) → read snapshot service-side → copy blobs to cloner space (fresh keys) → `buildCloneRow` insert (service-role) → `record_clone`. **On any failure: `batchDeleteFromR2` partial cloner blobs + `refundStorage` the reservation** (mirror `uploadToR2`'s rollback). Rate-limited (~10/min). Returns `{ entityType, id }`. |
| `POST /v1/community/listings/:id/favorite` | session | Toggle. |
| `POST /v1/community/listings/:id/report` | session | Insert report (reason enum); dedup partial-unique; rate-limited. |

Scope: clone creates an asset → `assets:write` (mirrors `duplicate`). Favorite/report are personal-state → session-only (matches existing gallery/template/app favorites — no scope guard).

## 9. Admin moderation

Covered by the admin routes (§8). Takedown = `is_active=false` + synchronous purge; the backstop reaper hard-deletes inactive rows after the grace window. Since publishers are admins, no durable-ban table is needed (a re-publish is an admin decision). Reports let users flag admin-curated content; `real_person_no_consent` is fast-tracked. Queue UI mirrors the existing gallery-reports admin page.

## 10. Frontend

- **`/explore`** (DashboardLayout child, session, `isMultiUser()`-spread route): tabs Characters · Locations · Objects; `ViewMode = "browse" | "favorites"` (+ "Published" only for admins); search/filters/sort; `IntersectionObserver` infinite scroll. Reuse card layout + browse/favorites query-hook shapes + filter/sort JSX + `app-categories.ts`; **build a NEW image-grid preview/clone modal** (template preview is a ReactFlow canvas, apps have none).
- **`preview_images` producer:** the publish service copies a bounded, entity-aware set into `community/<id>/` (characters ≈ up to 8: portrait + a few expressions/poses + sheet; locations/objects ≈ 3-4 angles), counted in `published_bytes`.
- **Admin publish dialog** (in studio headers — `character-studio-modal.tsx:118`, `location-studio-modal.tsx:158`, `object-studio-modal.tsx:156` — and gallery cards, shown only when the user is an admin): title, description, category, tags, **attestation checkbox**; for characters, the **likeness-attestation checkbox + honest notice** ("published renders are visible to all users; the generated likeness will be public").
- **Stale indicator** (admin-only): compare the listing's `updated_at` (from an admin "my published" fetch) vs the entity's `updated_at` (already returned by `GET /v1/characters|locations|objects/:id` — no node-data-field change, **no `gen:skills`**). Hidden when `source_id IS NULL`.
- **Nav:** add `readonly multiUserOnly?: boolean` to `NavItem`, import `isMultiUser` in `app-sidebar.tsx`, filter in **both** render sites (collapsed ~303 and expanded ~344). Publish entry points additionally check the admin role.
- **Report** affordance on detail (reason select incl. "depicts a real person").

## 11. Credits / billing

Publish/clone run no jobs → zero credits. **Storage is Cloud-only** (`hasCredits()`): clone reserves against the cloner (`reserveStorageIfWithinLimit`; the 413 `storage_limit_exceeded` → `StorageExceededError` → `StorageExceededModal` chain exists) and refunds on rollback; publish accounts `published_bytes` against the publishing admin and **refunds on purge** (idempotent via the `r2_assets_purged_at` CAS, §3). In Business, all storage helpers no-op (no quota system exists for any asset — existing behavior). Publishing doubles the admin's storage (two copies); refunded on takedown. Document in `backend/CLAUDE.md`.

## 12. Docs & SDK

- New `docs/` community page (honest safety section; admin-only publish). `docs/api-integration.md` + `docs/sdk-reference.md` for `/v1/community/*` (+ admin routes).
- `@nodaro/sdk` `community` resource: browse/detail/favorites/clone/favorite/report (user surface). Publish lives on the admin surface (`requireAdmin`) — document it as admin-only. `.changeset/`.
- **No `gen:skills`** (no node-data-field changes in v4). `GET /v1/nodes` unaffected. MCP: out of v1.

## 13. Testing strategy

- **Exhaustive classification (unit):** query `information_schema.columns` per entity table; assert every column is in exactly one of `publicTextFields | assetFields | stripFields | explicitlyIgnored` — fail on unclassified (catches `main_image_url`, `custom_variations`).
- **Asset independence:** clone survives deletion of listing blobs; listing survives deletion of the source.
- **Lifecycle:** publish → edit → re-publish (reuses id, old prefix purged + bytes refunded once, `updated_at` bumped) → unpublish (purge + refund) → re-publish → source delete (frozen, still clonable).
- **Idempotent refund:** unpublish then backstop-sweep the same listing → `published_bytes` refunded **exactly once** (CAS on `r2_assets_purged_at`).
- **Pagination:** `listObjectsByPrefix` returns + deletes >1000 objects (continuation loop).
- **RLS/auth:** anon (no JWT) cannot read `community_listings` or snapshots; non-admin cannot hit publish/patch/takedown (`requireAdmin`); admin publish requires attestation (+ likeness for characters); clone increments count once + writes one `community_clones`; clone rollback refunds + deletes partial blobs on failure.
- **Cursor:** stable across `clone_count` ties (base64 `{count,createdAt,id}`).
- **DB hardening:** Supabase linter shows no mutable-`search_path` findings; `search_vector` generated column creates.
- **Edition:** routes unregistered + `/explore` absent under `isCommunity()`; backstop sweep runs under `isMultiUser()` (dev). Storage tests run under Cloud (`hasCredits()`).
- Full backend + frontend vitest before shipping.

## 14. File-by-file change map

**Backend** — `supabase/migrations/201_community_sharing.sql` (5 tables, RLS, indexes, `UNIQUE(source_id)`, `publish_community_listing` + `record_clone` RPCs + favorite trigger — all hardened `search_path`, likeness `CHECK`, `immutable_array_to_string`); `lib/config.ts` (`isMultiUser`); `lib/entity-naming.ts`; `lib/storage.ts` (`copyR2ObjectToPrefix`, `listObjectsByPrefix` + `ListObjectsV2Command` import); `ee/lib/community-entity-adapters.ts`; `ee/services/community/` (publish, clone, snapshot, asset-copy, reaper); `ee/routes/community.ts` (user) + `ee/routes/admin-community.ts` (admin, `requireAdmin`); `app.ts` (`if (isMultiUser())`); `server.ts` (backstop sweep under `isMultiUser()`).

**Frontend** — `lib/edition.ts` (`isMultiUser`); `ee/app/explore/`, `ee/components/community/` (image-grid modal, report), `ee/app/(admin)/` (publish dialog, reports queue); `lib/api.ts`; `router.tsx`; `app-sidebar.tsx` (`multiUserOnly`, both sites); studio headers + gallery cards (admin-gated publish action). **No `types/nodes.ts` change.**

**SDK / docs** — `packages/client/` (`community` resource; publish documented admin-only) + `.changeset/`; `docs/` (community page, api-integration, sdk-reference).

## 15. Phasing

1. Schema + `isMultiUser()` + ee-import green.
2. Backend core: adapters (+ exhaustive-classification test), `copyR2ObjectToPrefix`/`listObjectsByPrefix`, snapshot builder, publish RPC + clone (+`record_clone`, rollback) + browse + detail, reaper (sync purge + backstop), asset-independence + lifecycle + idempotent-refund tests.
3. Admin routes: publish/patch/unpublish + reports/takedown; clone storage (Cloud) tests.
4. Frontend: Characters first (admin publish dialog + likeness attestation, image-grid clone/preview, stale indicator), then Locations/Objects (adapter + tab config).
5. SDK + docs + full-suite.

## 16. Risks / watch-items

- **Likeness:** admin attestation + report→takedown; trusted-publisher model removes the self-serve risk.
- **Storage:** quota is Cloud-only by design (Business unbounded — existing behavior, not a regression). Publish doubles the admin's storage; refunded once on purge (CAS-guarded). Lever if cost spikes: clone-time *reference* instead of copy.
- **Re-publish/takedown blob lifecycle:** prefix-purge primitive (paginated, idempotent refund) handles takedown, re-publish, and backstop. Re-publish reuses the id and resets `r2_assets_purged_at`.
- **Snapshot IP:** protected deny-by-default table; routes return public projection + curated `preview_images` only.
- **`server.ts`** already runs ungated crons — the `isMultiUser()` backstop is low-risk.
- **Future self-serve publishing:** when lifted beyond admins, re-introduce the consent gate, the durable-takedown model, and (if anonymous browse is added) the public-route whitelist + anon column protection — all deferred here because publishing is admin-only.
