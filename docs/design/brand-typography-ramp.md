# Brand Typography Ramp — Design

**Status:** Shipped

## Goal

The brand layer already lets a `brand` (a preset id or inline tokens, see
[`list_brand_presets`](../mcp/tools.md#list_brand_presets)) pin a palette and
a font *family* (heading + body) across a rendered
[shot-sequence](../mcp/shot-sequence.md) video. That controls *which*
typeface renders, but not how it reads — a heading and its body copy in the
same font family still need different weight, case, and spacing to read as
"designed" rather than "the same paragraph, twice." This doc covers the
typography ramp: giving a brand two more independent levers per role
(heading, body) — **weight**, **casing**, and **tracking** — on top of the
font family it already controls.

## The token model

`BrandFonts` gains two optional fields, one per role:

```ts
type BrandCasing = "uppercase" | "lowercase" | "none"

interface BrandTypeSpec {
  weight?: number       // CSS font-weight; must be a weight loaded for the role's font
  casing?: BrandCasing  // absent = inherit call-site; "none" = force no transform
  tracking?: number     // letter-spacing in em; suppressed for Arabic text
}

interface BrandFonts {
  heading: SupportedFontName
  body: SupportedFontName
  headingType?: BrandTypeSpec
  bodyType?: BrandTypeSpec
}
```

All three fields are optional and independent — a brand can set only
`casing` and leave weight/tracking to the blueprint's own default, or set all
three, or set none (in which case behavior is byte-identical to before this
feature existed).

## Precedence

Three-level fallback, resolved once per role via `resolveHeadingType` /
`resolveBodyType`:

1. **The element's own explicit value** — if a text element in the plan sets
   its own `fontWeight` or `letterSpacing`, that value wins outright.
2. **The brand's `headingType` / `bodyType`** — applies when the element
   didn't specify its own value.
3. **The blueprint's hardcoded fallback** — every blueprint already ships a
   sensible default (e.g. a label weighted 400 with light tracking); this is
   what renders when neither the element nor the brand say otherwise, and
   it's what rendered before brand typography existed.

This mirrors the existing accent-color precedence (explicit param → brand →
blueprint default) so there's exactly one precedence rule to remember across
the brand layer, not one per property.

## Arabic tracking suppression (load-bearing)

Letter-spacing is a Latin/Hebrew typographic convention — it inserts fixed
gaps between glyphs. Arabic script is cursive: letters join into ligature
forms depending on their neighbors, and forcing letter-spacing between them
breaks that joining, turning readable Arabic into disconnected, malformed
glyphs.

The resolver detects Arabic codepoints in the text being styled and, when
present, never emits a `letterSpacing` value — regardless of what the brand
or blueprint fallback requested. Hebrew is unaffected: it's also
right-to-left but not a joining script, so tracking renders normally there.

This check runs per-text-element (not globally per-video), so a bilingual
video with an Arabic heading and a Latin body caption gets tracking
suppressed only where the script requires it.

## Weight-must-be-loaded limitation

A `weight` value only takes effect if that exact weight is in the *loaded*
weight set for the chosen font family. Fonts don't ship with every weight
from 100–900 available — the renderer only loads the specific weights each
composition actually uses, both to avoid pulling hundreds of unnecessary font
files over the network at render time and because most of the supported
typefaces don't have a full weight range to begin with (a display face like
Anton, for instance, only exists at one weight).

**What happens on an unloaded weight:** nothing throws. The browser/renderer
silently snaps to the nearest weight that *is* loaded for that family. This
is standard CSS font-matching behavior, not a Nodaro-specific fallback — but
it means a brand author who requests a weight the font doesn't have won't
get an error, just a different (nearest-available) render than they might
expect.

**The decision:** rather than surface this as a runtime validation error
(which would require knowing every font's loaded-weight table at
brand-authoring time, for very little payoff), the built-in presets are
simply constrained to only ever request weights that are loaded for their
paired fonts — verified by a guard test that walks every preset's
`headingType`/`bodyType` weight against the render engine's loaded-weight
table. Custom/inline brand tokens can still request an unloaded weight; they
just get the browser's nearest-weight substitution instead of a hard error.

## Non-goals

- No font **size** scale — this ramp is weight/casing/tracking only; sizing
  stays per-blueprint.
- No per-language weight/casing override — a brand's typography spec applies
  uniformly across scripts (only tracking is script-conditional, and only to
  suppress it for Arabic).
- No image-logo support — this ramp is text typography; brand logos remain
  text-based (`name` + optional `tagline`).

## Related

- [MCP Tools Reference — `list_brand_presets`](../mcp/tools.md#list_brand_presets) —
  the tool that returns brand presets, including their typography settings
- [Video Director](../mcp/video-director.md) — the `brand` param this
  typography ramp extends
- [Shot Sequence](../mcp/shot-sequence.md) — the underlying brief/plan format
