# Node Presets

A **preset** is a named snapshot of a node's configuration — its prompt, model, provider, and all
parameter/input fields. Save a configuration once, then load it onto any node of the same type in
one click. Presets make it easy to reuse a "look" or a use-case setup across your workflows.

Presets work for **every node type** in the editor, and any new node type gets them automatically.

## Factory vs. custom presets

- **Factory presets** ship with Nodaro for the most-used nodes (for example, *Cinematic Portrait*
  for image generation). They're read-only starting points.
- **Custom presets** are the ones you create. They're private to your account and sync across your
  devices.

## Using presets

Every configurable node has a **preset dropdown** in two places:

- In the node's **config panel** — just below the node-type heading (or on the side in fullscreen).
- On the **node itself** — in the top-right hover toolbar, left of the ⋯ menu.

The dropdown starts empty. Open it to:

- **Select a preset** — loads its settings onto the node. Selecting a preset that would overwrite
  your current settings asks you to confirm first. (Undo with ⌘/Ctrl-Z.)
- Once a preset is active, its **name shows in the dropdown**. If you then change any of its
  settings, a **`*`** appears next to the name so you know you've diverged from the saved preset.
- **Save as new** — capture the node's current settings as a new custom preset.
- **Override “…”** — update the active *custom* preset with the node's current settings (asks you
  to confirm). Factory presets can't be overridden.
- **Search** — filter presets by name or description.
- **Import / Export** — back up or share presets as a `.json` file.
- **Delete** — remove one of your custom presets (hover a row).

The dropdown appears automatically on any node that has configurable settings. Nodes with no
settings (such as sticky notes) and asset nodes (Character/Location/Object) don't show it.

## What a preset captures

A preset stores the node's **reusable configuration** — prompt, model, provider, aspect ratio,
resolution, quality, seed, voice, style, numeric parameters, and so on.

It deliberately does **not** store:

- **Results / run state** (generated images, videos, job status) — those are outputs, not settings.
- **The node's label** — applying a preset never renames your node.
- **Wired inputs (field mappings)** — connections to other nodes are specific to one workflow and
  aren't portable, so they're left untouched when you apply a preset.

Because a preset applies the provider and its dependent settings together, switching to a preset
built for a different provider just works — any setting that doesn't apply to the new provider is
adjusted automatically.

## Export / import format

Exported files are versioned JSON:

```json
{
  "kind": "nodaro.node-presets",
  "version": 1,
  "exportedAt": "2026-06-05T12:00:00.000Z",
  "presets": [
    {
      "nodeType": "generate-image",
      "name": "Cinematic Portrait",
      "description": "Moody, shallow-depth portrait look.",
      "data": { "provider": "nano-banana-pro", "aspectRatio": "9:16" }
    }
  ]
}
```

On import, any preset whose name already exists for that node type is kept by appending
"(imported)" to its name, so importing never overwrites your existing presets.
