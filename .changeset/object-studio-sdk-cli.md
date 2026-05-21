---
"@nodaro/client": minor
"@nodaro/cli": minor
---

Add Object Studio surface to SDK + CLI.

- `@nodaro/client`: new `ObjectsResource` exposed as `client.objects`, with 13 methods (`list` / `listArchived` / `get` / `create` / `update` / `delete` / `permanentDelete` / `restore` / `generate` / `generateAsset` / `generateMotion` / `approveMainImage` / `recaption`).
- `@nodaro/cli`: new `objects:*` subcommand group with 11 commands. `--watch` polls completion inline.

Object-specific deltas vs locations:
- 10-value category enum (furniture / vehicle / weapon / food / clothing / electronics / nature / tool / animal / other)
- 5-value asset-type enum (angles / materials / variations / motion / custom) → 4 attach columns (motion routes to `motion_clips`)
- 5-value aspect-ratio union (adds 4:3 for product-showcase framing)
- `generate-motion` defaults: provider `kling-turbo` + aspect ratio `1:1` (not the location `kling` / `16:9` cinematic defaults)
- `delete --permanent` flag for hard-delete (archived rows only); mirrors SDK's `permanentDelete()`
- `approve-main-image --expected-updated-at` for optimistic-concurrency-guarded approval
- `--seed-prompt-hint` on `generate` / `generate-asset` / `generate-motion` (Pass 7 F-77 parameter-picker pass-through)
