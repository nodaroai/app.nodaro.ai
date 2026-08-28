# Parameter nodes — shared behaviour

Parameter nodes are pickers on the canvas. They never call a model and never
produce a job: each one composes a **prompt fragment** that is injected into a
downstream node's prompt, either through that node's `cinematography` handle or
by wiring the picker straight into a Text Prompt / Combine Text / LLM Chat
input.

The per-node pages in this folder list each picker's own fields and catalog.
This page covers the fields **every** picker shares.

## Free text: `preText` / `postText`

Two optional free-text fragments composed around the structured hint:

```
preText, <composed hint>, postText
```

Both are plain strings, both default to empty, and an empty one contributes
nothing (no stray commas). Use them for one-off detail the catalog does not
cover — `"wet-haired, covered in paint"` before, `"wearing a leather jacket"`
after.

## Prompt hint mode

Every catalog-backed picker can inject its selection in one of two registers:

| `hintMode` | What gets injected | Example (Framing → medium close-up) |
|---|---|---|
| `full` (default) | The long descriptive hint — the full clause, written for models that respond to prose. | `medium close-up, subject framed from the chest up` |
| `compact` | The short professional term — the words a crew would actually use. | `medium close-up` |

Both registers describe the same selection. `full` gives a diffusion model more
to hold on to; `compact` keeps the prompt short when many pickers feed one
generation, or when the model already knows the trade vocabulary and the long
form only dilutes it. `preText` / `postText` are appended in both modes.

**Where to set it.** Hover (or select) any picker node on the canvas: the
control row at the top of the card carries a **Prompt hint** toggle on the left
— `Full` / `Compact` — beside the existing Picks / Prompt / Both display-mode
toggle. Switch the node to the **Prompt** or **Both** display mode to read the
exact fragment the node will inject; the preview updates with the toggle.

**Defaults and compatibility.** The field is absent on nodes created before the
lever existed, and absent means `full` — no existing workflow changes behaviour.
Nothing is rewritten when you switch: the mode is stored as `hintMode` in the
node's data, so it travels with copy/paste and node duplication, is captured by
[node presets](../presets.md), and survives export/import.

**Authoring workflow JSON directly** (MCP, SDK, or an imported file): set it on
the picker node's `data`.

```json
{
  "id": "framing-1",
  "type": "framing",
  "data": { "label": "Framing", "shotSize": "medium-close-up", "hintMode": "compact" }
}
```

Only `"full"` and `"compact"` are meaningful; any other value is treated as
`full`.

**Which nodes have it.** Every picker listed under *Picker nodes* in the
[node reference](../README.md) — the Look, Camera, Subject / Object and Audio
picker families. The free-text and pure-runtime parameter nodes (Tone, Style
Guide, Provider, Scene Count, Duration, Aspect Ratio, Motion) have no catalog
term behind them, so they carry no hint-mode toggle.
