# Prompt pre & post text

Every AI node that has a prompt — image, video, audio, music, speech, LLM, script, vision,
analysis and Suno nodes — can carry two optional pieces of text that are wrapped **around** the
prompt when the node runs:

| Field | Where it goes |
|-------|---------------|
| `promptPrefix` | Before the prompt |
| `promptSuffix` | After the prompt |

They are **settings, not prompt**: you set them in the node's settings panel (the collapsed
**Pre & post text** section), they never appear on the node itself, and a published app's
end users never see them. That makes them the right place for anything you want applied to
*every* run without the person typing the prompt having to know about it:

- **Apps / thin clients.** Your app exposes a prompt input; the prefix and suffix add the
  house style ("Cinematic 35mm still of …", "…, golden hour, shallow depth of field") around
  whatever the user types.
- **Presets.** A preset that ships its doctrine in `promptPrefix` / `promptSuffix` leaves the
  prompt field free — apply the preset, type your subject, and the preset's text still wraps it.
  (A preset that puts its text in `prompt` is overwritten the moment you type.)

## What gets wrapped

The pre/post text wraps **whatever prompt the run uses** — the text typed in the node, a prompt
wired in from an upstream node, or each item of a list fan-out — *before* the platform adds its
own pieces (connected Look / cinematography hints, character references, the `Style:` and
`Avoid:` suffixes). In other words, it behaves exactly like text you typed into the prompt.

Both fields support the same things the prompt does: `@` references, `{Node Label}` variables
(resolved at run time) and `/` snippets (inserted as plain text).

Only the positive prompt is wrapped — the negative prompt is untouched.

## How the pieces are joined

Blank parts are dropped. Between two parts a **single space** is inserted, unless the boundary
already has whitespace on either side, or the second part starts with `, . ; : ! ? )`. Text is
never trimmed, so you control the formatting:

| Prefix | Prompt | Suffix | Result |
|--------|--------|--------|--------|
| `Cinematic 35mm still of` | `a woman in Tokyo` | `, golden hour` | `Cinematic 35mm still of a woman in Tokyo, golden hour` |
| `RULES:⏎- no text⏎⏎` | `a red shoe` | — | `RULES:⏎- no text⏎⏎a red shoe` |
| — | `a red shoe` | `Avoid clutter.` | `a red shoe Avoid clutter.` |
| `Portrait of {Character}` | *(empty)* | — | `Portrait of Mira` |

If the prompt is empty, the pre/post text alone is the prompt — so a preset can carry its whole
prompt in the prefix. Note this replaces any built-in default a node would otherwise use for an
empty prompt (for example Image to Text's default "describe this image" question).

The **Final view** of any prompt field shows the assembled result with the pre/post text tinted
**teal** ("Pre/post text" in the legend).

> **Generate Script** wraps the script *prompt* (the topic that arrives on its prompt handle),
> not the Style Guide field.

## Programmatic access

The fields are ordinary node data, so every surface that reads or writes workflow JSON already
carries them:

- **Workflow JSON** (REST `POST/PUT /v1/workflows`, SDK `client.workflows.create/update`,
  CLI `nodaro workflows …`, MCP `create_workflow` / `update_workflow_json` / `import_workflow`):
  set `data.promptPrefix` / `data.promptSuffix` on the node.
- **Per run, without exposing them** — REST `POST /v1/app/:slug/run` with
  `inputOverrides: { "<nodeId>": { "promptPrefix": "…" } }`, SDK
  `client.apps.run(slug, inputs, { inputOverrides })`, MCP `run_app` `inputOverrides`, CLI
  `nodaro apps run <slug> --override <nodeId>.promptPrefix="…"`.
- **Presets** capture and apply them like any other setting (`GET /v1/node-presets`,
  `client.presets`, `nodaro presets`, MCP `get_node_preset`). The MCP `generate_image` /
  `generate_video` / `generate_music` / `text_to_audio` verbs with a `presetId` wrap your
  `prompt` with the preset's pre/post text — as does `generate_speech`, which wraps its `text`.
- **Discovery:** `GET /v1/nodes` lists `promptPrefix` and `promptSuffix` in the `inputSchema`
  of every node that supports them (`nodaro nodes get <type>`).
- **Single-shot generation calls** (`POST /v1/generate-image`, `client.images.generate`,
  `generate_image` without a preset, …) take one `prompt` — concatenate the text yourself.

See also: [Prompt snippets](./prompt-snippets.md), [Presets](./nodes/presets.md),
[Node reference](./nodes/README.md).
