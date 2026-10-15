# Palettes and moodboards

Save your own **colour palettes** and **moodboards** once, then steer any
`generate-image` run with one — the same way you pick a built-in colour look or
style, but with your own colours and your own reference images.

| | A palette | A moodboard |
|---|---|---|
| What it holds | A name, 2–12 colours (`#RRGGBB`), an optional note (up to 500 characters) | A name, an optional description (up to 1,000 characters), 1–12 images `{ url, caption? }` |
| Used as | `direction.colorLook: "palette:<id>"` | `direction.style: "moodboard:<id>"` |
| What a run gets | Every colour in the prompt, by an everyday name and its hex | The description in the prompt, and the images as **style references** |

Both are yours only: another person's id answers `404`, exactly like an id that
does not exist. Available on every edition.

## Manage them

| Method | Path | Body / query | What it does |
|---|---|---|---|
| `GET` | `/v1/palettes` | `limit` (1–100, default 50), `cursor` | Your palettes, newest first: `{ data, nextCursor }`. |
| `POST` | `/v1/palettes` | `{ name, colors, description? }` | Create one. `201` with the palette. Colours are `#RRGGBB` in any case and are stored upper case. |
| `GET` | `/v1/palettes/:id` | | One palette. |
| `PATCH` | `/v1/palettes/:id` | any of `name`, `colors`, `description` | Only the fields you send are written; `description: null` clears it. |
| `DELETE` | `/v1/palettes/:id` | | `{ success: true }`. |
| `GET` | `/v1/moodboards` | `limit`, `cursor` | Your moodboards, newest first: `{ data, nextCursor }`. |
| `POST` | `/v1/moodboards` | `{ name, description?, images }` | Create one. `201` with the moodboard. |
| `GET` | `/v1/moodboards/:id` | | One moodboard. |
| `PATCH` | `/v1/moodboards/:id` | any of `name`, `description`, `images` | Only the fields you send are written; `images` replaces them all. |
| `DELETE` | `/v1/moodboards/:id` | | `{ success: true }`. Only the moodboard goes — the images it links to are untouched. |

**Moodboard images are links, never copies.** Each `url` must be an `http(s)`
address that is not `localhost` or a private network (the same check as every
reference image the API takes), at most 2,048 characters; a caption is at most
200. The image stays usable as long as whatever it points at does — an image
you delete, or one your plan's media retention removes, is gone from the
moodboard too.

`nextCursor` is an opaque token: pass it back as `cursor` for the next page
(`null` on the last one); a cursor the list did not hand out answers `400`.

**Scopes (OAuth apps):** reads need `assets:read`, writes `assets:write`.
Writes are limited to 30 requests a minute. On a server whose database does
not have them yet, the lists answer empty and the writes answer
`503 not_available`.

The same routes are wrapped by the SDK (`client.palettes`, `client.moodboards`
— see the [SDK reference](./sdk-reference.md#clientpalettes)), the CLI
(`nodaro palettes`, `nodaro moodboards` — see [CLI](./cli.md)) and the MCP tools
`list_palettes`, `save_palette`, `list_moodboards` and `save_moodboard`
([MCP tools](./mcp/tools.md#list_palettes)). There is no delete over MCP.

## Use one on generate-image

```json
{
  "prompt": "a lighthouse on a cliff at dusk",
  "provider": "nano-banana-pro",
  "referenceImageUrls": ["https://example.com/my-lighthouse.png"],
  "direction": {
    "colorLook": "palette:0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f",
    "style": "moodboard:1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "lightingStyle": "rembrandt"
  }
}
```

The palette and the moodboard sit in the `direction` object beside any
[built-in direction ids](./api-integration.md#cinematic-direction-direction-on-generate-image),
and fold the same way — on the film line of the prompt's `[style]` section,
where the built-in colour look and style would go:

```
a lighthouse on a cliff at dusk
…

[style]:
color palette: petrol blue #0F4C5C, honey #E3B23C. Moody Nordic interiors, soft daylight
…
```

- **A palette** becomes `color palette: <name> <hex>, …` — each colour by its
  nearest everyday name (a model follows a named colour more reliably) and its
  exact hex, in your palette's order. Its note is yours and is not put into
  the prompt.
- **A moodboard** puts its description in, as you wrote it (on one line). With
  no description, only its images go.
- **Like every direction clause, these are shed first** when a prompt is over
  the model's prompt limit — never your prose or your references.

### A moodboard's images are style references

The images go to the model as reference images, each with a short line telling
the model to take the colours, light, texture and mood from it — not its
subject or layout — plus its caption when it has one.

- **Your own references come first.** Images you send yourself
  (`referenceImageUrls`, `connectedReferences`, a wired character…) keep their
  places and their numbering; the moodboard's images only fill the reference
  seats left after them.
- **Never more than the model takes.** Each model accepts a set number of
  reference images (`GET /v1/models` lists it); images that do not fit, in your
  moodboard's order, are not sent, and the answer says so:

  ```json
  {
    "jobId": "…",
    "warnings": [{
      "code": "moodboard_images_not_sent",
      "message": "5 of the 12 images of moodboard \"Nordic calm\" were not sent as style references: the model (nano-banana-pro) takes at most 8 reference images, and your own references come first."
    }]
  }
  ```

  The same warning is kept on the job (`input_data.warnings`). A model that
  takes no reference images sends none of them; the description still goes in.
- **What it costs:** the images are references, so a run is priced like any
  run with that many references — a text-to-image model with references runs
  on its image-to-image version, and models priced per reference image count
  them. The price checked before the run and the price reserved for it count
  the same images, the ones actually sent.
- **`aspectRatio: "auto"`** keeps the shape of the first image a run sends.
  When you send no image of your own, that is the moodboard's first image.

### Ids, not copies

The job records the ids exactly as you sent them (`input_data.direction`), so
running it again uses the palette or moodboard as it is then. Change a palette
and the next run uses the new colours; delete it and a run that still names it
answers `404 direction_not_found`.

### Errors

| Status | Code | When |
|---|---|---|
| `400` | `validation_error` | `palette:` / `moodboard:` not followed by an id (a uuid); a palette anywhere but `colorLook`, a moodboard anywhere but `style`; one combined with another value on the same key. `field` names the key. |
| `404` | `direction_not_found` | The palette or moodboard is not yours, or no longer exists. `field` names the key (`direction.colorLook` / `direction.style`). |

Both answers come before anything is created or charged. Unlike built-in
catalog ids — an unknown one is skipped silently — your own palette or
moodboard is never ignored in silence.

**Generate-image only.** `POST /v1/generate-video` and `POST /v1/text-to-video`
answer `400 validation_error` for a `palette:` or `moodboard:` value.

**Not with a preset yet.** A request that applies a preset (`presetId`) folds
its direction in one step that cannot read your palettes and moodboards, so it
answers `400 validation_error` (with `field`) when its direction names one —
whether you sent it or the preset was saved with it. Send it without
`presetId`, or apply the preset on a Generate Image node in the editor and run
the workflow: a workflow run resolves it.

## In workflows, the SDK, the CLI and MCP

- **Workflows:** a Generate Image node whose `direction` names one is resolved
  each time the workflow runs (runs, apps, schedules, webhooks). A palette or
  moodboard saved in the workflow is looked up among its owner's, so a
  published app can use its creator's moodboard; one a run supplies (an app
  input, a run request's `inputOverrides`) is looked up among the person
  running it, so a runner can never name the creator's other palettes or
  moodboards. One that cannot be resolved fails that node before anything is
  created or charged; a moodboard that did not fit leaves the same warning on
  the node's job. The editor's single-node Run cannot apply them yet: it
  refuses such a node (nothing is sent or charged) — run the workflow instead.
  The node's Final view shows a note where the palette or moodboard will go.
- **SDK:** `direction: { colorLook: paletteDirectionId(id), style: moodboardDirectionId(id) }`
  on `nodes.run("generate-image", …)`; the answer types `warnings`.
- **CLI:** `nodaro palettes …` / `nodaro moodboards …` manage them.
- **MCP:** `generate_image` takes `palette_id` and `moodboard_id` (ids from
  `list_palettes` / `list_moodboards`), and its answer passes the warning on.
  Neither can be combined with `presetId` yet: the call is refused, and so is a
  preset saved with a palette or moodboard in its direction.
