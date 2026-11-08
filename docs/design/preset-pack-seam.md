# Preset Pack Seam — Design Note

**Date:** 2026-11-08
**Status:** Implemented

## Summary

Nodes with a preset menu ship a catalog of factory presets, curated data in
`@nodaro/prompts`. A deployment that curates what its users see could only
switch that catalog off (`catalogs.factoryPresets: false` in the surface
profile, see [Deployment](../deployment.md)). It had no way to ship presets of
its own.

The **preset pack seam** makes that a registration, the same way the
[catalog pack seam](./catalog-pack-seam.md) curates the picker catalogs. A
deployment registers **packs** at its composition root (a deployment overlay's
`register()`). The one function that serves factory presets,
`presetCatalog(nodeType)` in `backend/src/lib/presets/app-presets.ts`, serves
them. The bundled catalog is never edited.

With **no** pack registered the platform is byte-identical: `presetCatalog`
returns the bundled catalog itself, the same array as before the seam existed.

## The pack model

A pack is the presets a deployment registers for one node type (or app
namespace):

```ts
registerPresetPack({
  nodeType: "generate-image",
  presets: [
    {
      id: "generate-image/harbor-at-dawn",
      name: "Harbor at dawn",
      group: "Landscapes",
      data: { provider: "<model id>", prompt: "a quiet harbor at dawn", aspectRatio: "16:9", style: "watercolor" },
      previewUrl: "https://media.example.com/presets/harbor-at-dawn.webp",
    },
  ],
})
```

A pack preset is exactly a factory preset (`FactoryPreset`: `id`, `name`,
`description`, `group`, `groupKind`, `section`, `platforms`, `data`,
`minReferences`), plus an optional `previewUrl`. A factory preset's example
picture is a file committed under `/preset-previews/`. A deployment's is not,
so it names its own.

Over the API a pack preset looks like any factory preset. `minReferences` and
`needsImage` are derived from its data the same way. `previewUrl` is the one it
names, or null. It has no `previewSrcSet`, because it names one picture at one
size. The SDK's `FactoryPresetEntry` already describes all of this, so clients
need no change.

## Composition

| `catalogs.factoryPresets` | No pack for the node type | A pack for the node type |
|---|---|---|
| `true` (default) | the bundled presets | the bundled presets, then the pack's |
| `false` | none | the pack's only |

Several packs for one node type are served in registration order.

## Registration rules

`registerPresetPack` throws on a preset it could not serve faithfully, and then
registers none of the pack. An overlay loader turns a throw inside `register()`
into a refused boot. The rules:

- **The id is `<nodeType>/<slug>`.** That is the factory id shape. It also means
  a pack id can never look like a user's own preset (a uuid), which preset
  resolution looks up after the catalog.
- **The id is new.** It must not be a factory preset's id on any node type, or
  an id already registered. Favorites and `presetId` lookups key on it.
- **The preset has a name, and its `data` is an object** the preset library
  carries as it is. That excludes labels, run state, and an app namespace's
  contract broken. What is served is exactly what applies.

Each preset is stored as a copy. What the boot check validated is what is
served, whatever the caller later does with its own objects.

## The boot check

The overlay loader (`backend/src/lib/overlay/load.ts`) waits for the overlay's
`register()` to return. Then it runs `presetPackProblems()`
(`backend/src/lib/presets/preset-pack-check.ts`). If any registered preset
fails a rule below, the loader refuses to boot: exit 1, with every problem in
one message.

### Models

A preset may name only models the surface profile offers. The fields checked
are the ones a run takes its model from: `provider`, `providers`, `models` and
`llmModel`. They are judged against the profile's `models.allow` and
`models.deny`.

The profile alone decides. The admin's Availability override and model switch
change at run time, so judging by them would let a click in Admin stop the
next restart. A model an admin switches off later is refused at run, the same
as for any node that uses it.

### Picker ids

A preset may name only picker ids that the deployment's **composed** catalogs
offer. The composed catalogs are the base catalogs with every registered
catalog pack applied, the overlay's own included, in whatever order its
`register()` made its calls. So a preset cannot bring back an option the
deployment's curation removed.

The fields that hold picker ids are stated, never guessed from values. `"high"`
or `"auto"` is an option id in one catalog and a node's own setting elsewhere.
The fields:

- a picker node's own value fields, such as a Setting preset's `setting` or a
  Person preset's dimensions;
- `style` on the node types that resolve it through the Style catalog: Generate
  Image, Image to Image and Modify Image. A deployment preset names its style
  by id; free text belongs in the prompt;
- every key of `direction` and `subject`, each against the catalog its renderer
  reads. This is a fixed table, pinned to the direction and subject registries
  by a test, so a new key cannot go unchecked.

A reference to a user's own saved item (`palette:…`, `moodboard:…`) is refused
too. It belongs to one user, not to a deployment.

### Picture

`previewUrl` must be absent or an absolute https URL.

## One funnel

`presetCatalog` is the backend's only reader of the bundled presets. It is what
these surfaces list or resolve:

- the public, cached `GET /v1/node-presets/factory`;
- the MCP `list_node_presets` and `get_node_preset` tools;
- preset resolution (`presetId` on the image generation route and the MCP
  generation tools).

A second reader would serve the bundled presets around both levers: on a
deployment that switched them off, or without the presets it registered.
`backend/src/lib/presets/__tests__/factory-preset-funnel.test.ts` fails the
build on one.

## Scope notes

- **The canvas editor's preset menu** reads the bundled catalog in the browser,
  as before, and does not list a deployment's pack. Clients that read
  `GET /v1/node-presets/factory` do.
- **Localization.** A pack preset's name and description are served as written.
  The bundled presets' translations do not cover them.
