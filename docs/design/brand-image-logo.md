# Brand Image Logo — Design

**Status:** Shipped

## Goal

The brand layer's `logo` was text-only: a `name` and an optional `tagline`,
cascade-animated letter-by-letter by the `logo-assemble-lockup` blueprint (see
[Brand Typography Ramp](./brand-typography-ramp.md)). That's a fine default,
but a lot of brands already have an actual logo mark and want *that* on
screen instead of a generated wordmark. This doc covers the v1 design for
`logo.image` — letting a brand supply a real image asset that renders inside
the shot-sequence pipeline's brand lockup scene.

## The URL-only decision

`logo.image` takes exactly one shape: an https URL, validated by a Zod
`.refine()` against `isOurCdnUrl()` — the URL's origin must match the
deployment's own configured public asset host (`R2_PUBLIC_URL`, or the exact
`R2_PUBLIC_FALLBACK_DOMAIN`). Anything else — a private-IP literal, an
arbitrary third-party image host, a non-https scheme — is rejected at schema
parse time, before it ever reaches a render.

**Why this is the right boundary to enforce, and why here specifically:** the
image is rendered by Remotion's `<Img>` inside a headless browser during the
render job — the browser fetches whatever URL it's given directly. An
unconstrained URL field on a server-triggered render job is a textbook
server-side-request-forgery (SSRF) shape: an attacker-supplied brand could
otherwise point `logo.image` at an internal service, a cloud metadata
endpoint, or any other address the render infrastructure can reach. Locking
the field to our own CDN's exact origin removes that class of attack
entirely, at the cost of a real (accepted) limitation — see "Deferred
fast-follows" below.

**One schema, not three copies.** `logo.image` lives inside `BrandTokens`,
which is validated by a single Zod schema (`brandTokensSchema` in
`plan-schemas.ts`) reused wherever a shot-sequence plan is parsed:

- the video-director orchestrator's bake step (shared by `create_explainer` /
  `create_launch_video` and by the manual `resolve_shot_sequence` path — both
  go through the same `bakeShotSequence` → `validatePlanByType` call),
- `render_shot_sequence` / the underlying `POST /v1/render-video/plan` route
  — the direct-render path a caller can hit without ever going through the
  director or the resolver, and
- the render worker's own re-validation of the plan immediately before
  handing it to Remotion, regardless of which route enqueued the job.

That's not three independent implementations of the check — it's the same
`.refine(isOurCdnUrl)` clause imported and re-applied at each layer, so there
is exactly one place to fix or audit if the allowlist logic ever needs to
change. A test in `plan-validate-logo.test.ts` (specifically: it rejects an
external logo.image in a pre-baked plan via the direct-render SSRF gate)
asserts that the ingress a caller is most likely to try to sneak an external
URL through — posting a pre-baked plan straight to `/v1/render-video/plan` —
is rejected identically to the authored-brief path.

This is also, in practice, a *stricter* check than nearby fields: `audio.src`
(which lives in the same shot-sequence plan schema) uses the general syntactic
SSRF gate (`safeUrlSchema` — blocks localhost/private-IP literals but allows
any other public http(s) host). The `image` element's `src` is not part of the
shot-sequence plan — it lives in a separate schema (`sgMediaSegmentSchema` in
the `sceneGraphPlanSchema`). `logo.image` goes further than both and pins the
origin to our own CDN specifically, because unlike a Node-side download,
nothing else re-validates the URL before Remotion's browser fetches it.

## Contained in the blueprint

The image capability doesn't introduce a new element type, and the
`logo-assemble-lockup` blueprint's own `params` schema is unchanged (`brand`,
`tagline`, `accentColor` — the same three fields as before). The image comes
from the resolved `BrandTokens` object already threaded to every blueprint as
an ambient `brand` prop, not from anything the brief author passes to this
specific blueprint. Concretely: `LogoAssembleLockup` reads `brand.logo?.image`
/ `brand.logo?.imageBackdrop` directly, and `chooseLogoRender()` is a pure
decision — render the image when one is present and hasn't errored, else fall
back to the existing per-letter cascade of `params.brand` (the wordmark
text).

This keeps the blast radius to one file. No other blueprint, and no part of
the shot-sequence element schema (`text` / `shape` reveals), knows that
`logo.image` exists. That containment is deliberate — see "general image
element" below for the generalization this deliberately defers.

## The deterministic-net guarantee

A logo image is only worth uploading if it's actually guaranteed to appear
somewhere in the video — an LLM-authored brief that "forgets" to include a
`logo-assemble-lockup` reveal would silently make the feature a no-op. Two
layers make the appearance deterministic:

1. **Director steering.** `buildBrandBlock()` appends a MUST-include
   instruction to the authoring prompt whenever `brand.logo.image` is set:
   include exactly one `logo-assemble-lockup` reveal (intro or outro). This
   is the cheap, common-case path — the LLM almost always complies.
2. **A pure deterministic backstop.** `ensureLogoLockupScene(brief, brand)`
   runs after authoring, independent of what the LLM actually produced: if
   the brand has a logo image and the brief has no `logo-assemble-lockup`
   reveal anywhere, it appends a trailing branding scene with one. Identity
   in every other case — a brief that already includes the reveal, or a run
   with no logo image, comes back byte-identical. Wired into the
   orchestrator's `briefToBake` helper, so it runs on both the main bake and
   the self-repair re-bake (see the resolve-repair behavior documented in
   [Video Director](../mcp/video-director.md)).

The appended reveal anchors 100ms past the last narration cue's end rather
than exactly at it. Without the offset, an authored closing reveal that also
anchors to "last cue, end" (a common CTA-holds-to-the-end pattern) would tie
`frameAbs` with the appended scene, and the baker's overlap guard hard-rejects
exact ties instead of applying its normal tail-clamp recovery (that recovery
only fires when the earlier scene's own anchor frame is strictly before the
new scene's start). 100ms guarantees at least one frame of separation even at
the schema's lowest fps floor (15fps → 66.7ms/frame) — enough for the clamp
to trim the previous scene's tail instead of erroring.

Net effect: setting `logo.image` on a brand and calling `create_explainer` /
`create_launch_video` reliably puts that logo on screen, whether or not the
authoring LLM remembered to ask for it.

## Fallback behavior

If the image URL 404s, times out, or is otherwise unreachable at render time,
`<Img>`'s `onError` flips `chooseLogoRender()` back to the text cascade —
the render always completes; it just falls back to the wordmark instead of
failing the job. Remotion's `<Img>` retries a failing load (default: 2
retries, exponential backoff) before calling `onError`, holding the render
frame each time — so the fallback typically doesn't trigger until a few
seconds after the initial failed load. That matters operationally: if a
render is kicked off immediately after uploading the logo image, and CDN
propagation hasn't finished, the retry window may not be long enough to
bridge the gap — the render will fall back to the wordmark even though the
URL is valid and will resolve moments later. There's no special-cased retry
or wait added for this; a re-render after the image has propagated picks it
up normally.

## Accepted risk: no upload dimension cap

**Stated explicitly:** this feature does not add a pixel-dimension cap to
image uploads. `logo.image` must come from the same general-purpose
`/v1/upload` (or `/v1/upload/image`) endpoint every other node's image
uploads go through — it has no notion of "this upload is a logo." Uploads are
stored as-is (no resizing, no dimension changes) subject to the existing
file-size ceiling and image-format allowlist — note that HEIC/HEIF images are
transcoded to JPEG before storage, but pixel dimensions are preserved. There's
no per-pixel-dimension limit at any layer.

Adding one specifically for logos wasn't feasible without either (a) a new,
logo-specific upload path (more surface area, another thing to keep in sync
with the general uploader), or (b) a global dimension cap on `/v1/upload`,
which would risk rejecting legitimate large-image uploads for unrelated node
types that have no such constraint today. Neither seemed proportionate to the
actual risk: a logo URL, once validated, is fetched the same way and is no
riskier than the `audio.src` URLs `render-video` already accepts elsewhere in
the same plan — and the render route's existing rate limit (10 requests/minute)
already bounds how fast either could be abused. The blueprint itself
contain-fits the image into a fixed box regardless of source resolution, so an
oversized source image doesn't distort layout — it just costs more render-time
decode work than a right-sized one would.

## Deferred fast-follows

None of these are ruled out — they're out of scope for v1 because the URL
path alone already covers the common case (a marketing team has a logo PNG
somewhere and can paste a link to it):

- **Asset-id-by-reference** — pass an existing Nodaro asset id instead of a
  raw URL, so a logo already in your library doesn't need a separate upload
  round-trip.
- **Corner-mark placement** — today the logo only appears inside the
  dedicated `logo-assemble-lockup` scene. A persistent small corner logo
  mark carried across every scene (distinct from the unrelated free-tier
  output watermark) is a materially different feature (continuous overlay
  vs. a discrete beat) and isn't built.
- **SVG support** — vector logos would render crisper at any size, but
  bringing SVG through the upload pipeline and Remotion's image loading is
  its own piece of work.
- **Auto-contrast plate** — `imageBackdrop` is manual today; automatically
  choosing (or suggesting) a backdrop color based on the logo's own palette
  and the scene background would remove a step for the author.
- **`logoInverse`** — a second logo variant for light-on-dark vs.
  dark-on-light scenes, swapped automatically instead of relying on one
  image plus a backdrop panel.
- **General image element** — a first-class `image` reveal/element usable by
  *any* blueprint or raw reveal, not just `logo-assemble-lockup`. This is the
  generalization the "contained in the blueprint" section above deliberately
  defers; it's a bigger surface (new element schema, new SSRF-boundary
  call sites to keep in sync) that didn't need solving to ship a working
  brand logo.

## Related

- [Video Director](../mcp/video-director.md) — the `brand`/`logo` MCP-facing
  documentation this design backs
- [Brand Typography Ramp](./brand-typography-ramp.md) — the palette/font/type
  model `logo.image` builds on top of
- [MCP Tools Reference — `list_brand_presets`](../mcp/tools.md#list_brand_presets)
- [Shot Sequence](../mcp/shot-sequence.md) — the underlying brief/plan format
  and blueprint catalog
