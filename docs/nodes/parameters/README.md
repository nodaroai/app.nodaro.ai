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

**Where to set it.** Two places, same lever. On the canvas: hover (or select)
any picker node — the control row at the top of the card carries a **Prompt
hint** toggle on the left — `Full` / `Compact` — beside the existing Picks /
Prompt / Both display-mode toggle. Switch the node to the **Prompt** or **Both**
display mode to read the exact fragment the node will inject; the preview
updates with the toggle. In the config panel: the same toggle sits beside the
**Will inject into prompt** preview at the top of every picker's panel, and that
preview shows the same composed fragment.

**Defaults and compatibility.** The field is absent on nodes created before the
lever existed, and absent means `full` unless the node is composed by a compact
composer (see *Inheritance* below) — no existing workflow changes behaviour.
Nothing is rewritten when you switch: the mode is stored as `hintMode` in the
node's data, so it travels with copy/paste and node duplication, is captured by
[node presets](../presets.md), and survives export/import.

**Inheritance.** Two pickers compose *other* pickers into one sentence:
[Camera Motion](./camera-motion.md) and [Transition](./transition.md), through
their `startState` / `endState` handles. Setting either of those to `compact`
propagates the mode into the pickers wired to those handles, so the composed
sentence stays at one level of detail instead of mixing a short term with two
paragraphs. A wired picker that declares its own `hintMode` always wins over
what it inherits — including an explicit `"full"`, which is how you opt one
input back out of a compact composer. A picker read on its own (the canvas
preview, the config-panel preview, a direct wire into a Text Prompt or an LLM
Chat) inherits nothing and uses its own mode, so the same node can read `full`
in its preview and inject `compact` inside a compact composer.

[Character FX](./character-fx.md) composes a `target` too, but a target is a
character / face / object / location reference rather than a picker — it
contributes a NAME, not a fragment, and that name is injected in both modes.

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
undeclared — which means `full`, or the mode inherited from a compact composer.
Compact is opt-in, so a typo can never silently shorten a prompt.

**Which nodes have it.** Every picker listed under *Picker nodes* in the
[node reference](../README.md) — all five families: Look, Camera,
Subject / Object, Multi-dim composed pickers (Framing, Lighting, Person,
Styling, Temporal, Exposure Settings) and Sound / Music / Voice. The free-text
and pure-runtime parameter nodes (Tone, Style Guide, Provider, Scene Count,
Duration, Aspect Ratio, Motion) have no catalog term behind them, so they carry
no hint-mode toggle.
