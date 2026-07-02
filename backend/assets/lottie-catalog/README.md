# Lottie Overlay Catalog

**Provenance:** first-party assets. The 12 animations here were authored with
Nodaro's own Lottie engine (baked — slots resolved, no `sid` refs) as
replacements for the third-party lottie.host catalog that went dead upstream.
They are licensed with the repository core under the root Sustainable Use
License and carry no third-party license obligations.

The canonical entry list (slugs, URLs, prompt copy) lives in
`packages/shared/src/lottie-overlay-catalog.ts` — single source of truth for
the overlay LLM's menu and the render-time legacy-URL remap. The files in this
directory are the exact bytes served in production:
`backend/src/scripts/mirror-lottie-catalog.ts` uploads them verbatim to
`https://cdn.nodaro.ai/lottie-catalog/<slug>.json`, and
`backend/src/lib/__tests__/lottie-overlay-catalog.test.ts` guards the
catalog/asset/prompt invariants.

**Self-hosters:** the CDN URLs above are public and resolve from any
deployment, so overlays work out of the box. To serve the catalog from your
own storage instead, run the mirror script against your bucket and re-point
`CDN_BASE` in `packages/shared/src/lottie-overlay-catalog.ts`.
