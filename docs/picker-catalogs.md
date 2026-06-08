# Parameter Picker Catalogs

Nodaro's editor has a family of **parameter pickers** — curated, tile-grid selectors for things like Mood, Lens, Setting, Framing, Lighting, Person, Music Genre, Voice Character, and ~40 more. A picker never calls the API; it contributes a **descriptive clause** to a downstream node's prompt. (The deepest multi-dim picker, **Person**, defaults to a **Compact** grouped-pill view with a per-device **Detailed** toggle for the full tile-grid; the view mode is purely presentational and never changes the emitted clause — see the [Person node page](./nodes/parameters/person.md).)

Every picker's data — its options, the prompt fragment each option contributes, its categories, and its i18n keys — ships as **pure data in [`@nodaro/shared`](https://www.npmjs.com/package/@nodaro/shared)**. So you can build the exact same pickers in your own app, in your own styling, and assemble the exact same prompts, with **no API calls and no coupling to Nodaro's UI**.

> **Why a library, not an API?** Picker catalogs are static config + pure functions. The SDK/API is for *server state* (jobs, credits, uploads, workflows). There is intentionally no `GET /v1/catalogs` — you `import` the data and run it locally (typed, offline, tree-shakeable).

```bash
npm install @nodaro/shared @nodaro/client
```

## The registry

```ts
import { PICKER_CATALOGS, getPickerCatalog, listPickerCatalogs } from "@nodaro/shared"
```

| Export | Description |
|--------|-------------|
| `PICKER_CATALOGS` | `readonly PickerCatalog[]` — every picker (27 single + 11 multi). |
| `getPickerCatalog(nodeTypeOrCatalogId)` | One catalog by `nodeType` (e.g. `"mood"`) or `catalogId`. |
| `listPickerCatalogs()` | All of them. |

```ts
interface PickerOption {
  id: string
  label: string            // English; localize via catalogId (see i18n)
  description?: string
  category?: string         // group id (matches categoryOrder / categoryLabels)
  promptHint: string        // the clause this option contributes ("" for no-op options like "auto")
  icon?: string             // reserved; previews are app-side — render your own (see Visual)
}

interface PickerDimension {       // multi-dim pickers only
  field: string                   // e.g. "shotSize"
  label: string
  options: readonly PickerOption[]
}

interface PickerCatalog {
  nodeType: string                // "mood", "framing", …
  label: string
  catalogId: string               // i18n key
  kind: "single" | "multi"
  valueField?: string             // single: the field a selection writes
  defaultValue?: string
  categoryOrder?: readonly string[]
  categoryLabels?: Readonly<Record<string, string>>
  options?: readonly PickerOption[]      // single-dim
  dimensions?: readonly PickerDimension[] // multi-dim
}
```

## Single-dimension pickers (e.g. Mood)

A single picker is one choice from a flat (optionally grouped) list. `options` carries everything you need to render the grid.

```tsx
import { getPickerCatalog, getParameterPromptHint } from "@nodaro/shared"
import { createClient } from "@nodaro/client"

const client = createClient({ apiKey: process.env.NODARO_API_KEY })
const mood = getPickerCatalog("mood")! // { nodeType:"mood", valueField:"mood", options:[…], categoryOrder, categoryLabels }

// 1. Render your own tile-grid (group by category if you like)
function MoodPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  return (mood.categoryOrder ?? [undefined]).map((cat) => (
    <section key={cat ?? "all"}>
      {cat && <h4>{mood.categoryLabels?.[cat]}</h4>}
      {mood.options!
        .filter((o) => !cat || o.category === cat)
        .map((o) => (
          <button key={o.id} aria-pressed={value === o.id} title={o.description} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
    </section>
  ))
}

// 2. Selection → prompt clause → run
const selected = "serene"
const clause = getParameterPromptHint({ type: "mood", data: { mood: selected } })
// (or just: mood.options!.find(o => o.id === selected)!.promptHint)

const prompt = ["a portrait of a woman", clause].filter(Boolean).join(", ")
const { jobIds } = await client.nodes.run("generate-image", { prompt })
```

## Multi-dimension pickers (e.g. Framing)

Some pickers set **several** independent fields at once — Framing is shot size **and** angle **and** coverage **and** composition **and** vantage. Each catalog exposes `dimensions`, one `{ field, label, options }` per field.

```tsx
import { getPickerCatalog, getParameterPromptHint } from "@nodaro/shared"

const framing = getPickerCatalog("framing")!
// framing.dimensions = [
//   { field: "shotSize",    label: "Shot Size",   options: [{id:"close-up", …}, …] },
//   { field: "angle",       label: "Angle",       options: [{id:"low-angle", …}, …] },
//   { field: "coverage",    label: "Coverage",    options: […] },
//   { field: "composition", label: "Composition", options: […] },
//   { field: "vantage",     label: "Vantage",     options: […] },
// ]

function FramingPicker({ value, onChange }: {
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
}) {
  return framing.dimensions!.map((dim) => (
    <section key={dim.field}>
      <h4>{dim.label}</h4>
      {dim.options.map((o) => (
        <button
          key={o.id}
          aria-pressed={value[dim.field] === o.id}
          title={o.description}
          onClick={() => onChange({ ...value, [dim.field]: o.id })}
        >
          {o.label}
        </button>
      ))}
    </section>
  ))
}

// Selection → clause. getParameterPromptHint composes all the set fields:
const value = { shotSize: "close-up", angle: "low-angle", composition: "rule-of-thirds" }
const clause = getParameterPromptHint({ type: "framing", data: value })
// → "close-up shot, …, low-angle, …, rule-of-thirds composition, …"
```

`getParameterPromptHint({ type, data })` is the **universal** way to turn any selection (single or multi) into its clause — the exact same function Nodaro runs server-side, so your output matches the editor's. (Per-catalog builders like `buildFramingHints(value)` exist too, if you prefer.)

## Putting it together

```ts
// Compose several pickers into one prompt, then generate.
const clauses = [
  getParameterPromptHint({ type: "mood",    data: { mood: "serene" } }),
  getParameterPromptHint({ type: "lens",    data: { lens: "portrait-85mm" } }),
  getParameterPromptHint({ type: "framing", data: { shotSize: "close-up", angle: "eye-level" } }),
]
const prompt = ["a portrait of a woman in a garden", ...clauses].filter(Boolean).join(", ")
const { jobIds } = await client.nodes.run("generate-image", { prompt, model: "gpt-image" })
```

## Localization

Catalog labels are English. Localized strings for **12 locales** (`en, es, fr, de, pt-BR, ru, hi, ja, ko, zh-CN, he, ar`) ship in `@nodaro/shared`, keyed by each catalog's `catalogId`. `promptHint` clauses stay English (they feed the model).

English needs no setup. For other locales, register the per-locale "sidecar" bundles once at startup, then resolve labels synchronously (with English fallback):

```ts
import { registerSidecarLoaders, ensureLocaleCatalogLoaded, resolveLabel } from "@nodaro/shared"

// 1. Once at startup (Vite app): wire the lazy-loaded locale bundles
registerSidecarLoaders(import.meta.glob("/node_modules/@nodaro/shared/src/i18n/*.*.ts"))

// 2. Before rendering a locale, load that catalog's bundle
await ensureLocaleCatalogLoaded(mood.catalogId, "fr")

// 3. Resolve a label (sync; falls back to English if missing or not yet loaded)
const label = resolveLabel(mood.catalogId, option.id, option.label, "fr")
```

The bundles load lazily, so `registerSidecarLoaders` takes a glob of loaders (Vite's `import.meta.glob`). Backends and tests skip i18n and use the English `label` directly.

## Visual

Picker `icon`/thumbnails are **not** shipped — the editor's previews are bespoke React components, and an external app should render its own visuals in its own style (the data gives you `label`, `description`, and `category` to build a rich grid). `icon?` is reserved for a future release that bakes static thumbnails into the catalog data.

## Reference

| | |
|--------|-------------|
| `getParameterPromptHint({ type, data })` | Selection → composed prompt clause (universal). |
| `build<Name>Hints(value)` | Per-catalog clause builder (e.g. `buildFramingHints`). |
| `get<Name>PromptHint(id)` | Single option → clause (e.g. `getMoodPromptHint`). |
| `PICKER_CATALOGS` / `getPickerCatalog` / `listPickerCatalogs` | The registry. |

See also: [SDK Quickstart](./sdk-quickstart.md) · [SDK Reference](./sdk-reference.md) · [Embed App Guide](./embed-app-guide.md)
