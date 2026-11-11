---
node_type: modify-image
generated_at: 2026-11-11T15:41:40.756Z
generated_from: ba01ae6af
---

# Modify Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `modify-image`
**Category:** ai
**Credit cost:** `7-682` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `image`, `mask`, `cinematography`
**Outputs (source handles):** `image`

**Required data fields:**
- `label: string`
- `prompt: string`
- `provider: ModifyImageProvider`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `promptPrefix?: string`
- `promptSuffix?: string`
- `style?: string`
- `strength?: number`
- `aspectRatio?: string`
- `resolution?: string`
- `quality?: string`
- `background?: string`
- `outputFormat?: string`
- `gifFrames?: number`
- `gifFrameDurationMs?: number`
- `svgLevel?: string`
- `negativePrompt?: string`
- `seed?: number`
- `renderingSpeed?: string`
- `guidanceScale?: number`
- `referenceImageUrl?: string`
- `maskUrl?: string`
- `characterDefinitionIds?: readonly string[]`
- `connectedMediaOrder?: readonly string[]`
- `referenceOrder?: readonly string[]`
- `suppressedCanonicalCharacterIds?: readonly string[]`
- `suppressedCanonicalLocationIds?: readonly string[]`
- `extraRefs?: readonly ExtraRef[]`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedImageUrl?: string`
- `generatedResults?: GeneratedResult[]`
- `activeResultIndex?: number`
- `currentJobId?: string`
- `currentJobProgress?: number`

**Default data:**
```json
{
  "label": "Modify Image",
  "prompt": "",
  "provider": "gpt-image-2-6-flare-i2i",
  "negativePrompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Image-to-image: edit / transform / restyle / outpaint / inpaint (`modify_image` over MCP). Call `list_models { kind: "image", mode: "i2i" }` or `mode: "edit"` for the capability sheets.

### Model guidance

- **`gpt-image-2-6-flare-i2i`** (default) — the newest GPT Image Flare: changes what you ask and keeps the rest. Medium quality unless you set one. Up to 16 source images, priced per image.
- **`gpt-image-2-i2i`** — identity-critical edits of a person, and text-heavy edits.
- **`nano-banana-2-1`** — good edits for a lower price, up to 10 references.
- **`ideogram-remix`** — character-aware, good for stylized remix.
- **`seedream-edit`** — high-res output for instruction-style edits.
- **`recraft-remove-bg`** — background removal, no prompt (`list_models` shows its credits).
- **Avoid `flux-kontext`** for general use — it degrades quickly across multi-turn edits; only for one-shot texture-heavy edits, and even then prefer GPT Image 2.6 Flare.

Provide ONE of `image_url` (any publicly fetchable HTTPS URL) or `image_asset_id` (a Nodaro job id whose output is an image).

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `modify_image`

**Input parameters:**
- `prompt`
- `image_url`
- `image_asset_id`
- `model`
- `resolution`
- `quality`
- `background`
- `output_format`
- `gif_frames`
- `gif_frame_duration_ms`
- `svg_level`
- `aspect_ratio`
- `negative_prompt`
- `mask_url`
- `structured`
- `user_request`
- `flow_id`
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

### Getting a URL for a user-attached image (bytes only in chat, no URL yet)

- **Path A** (preferred — Claude.ai web/Android with widget rendering): `upload_image_widget` opens an in-chat file picker (multi-file via `max_files`, e.g. character training or headshot sets). The widget uploads the file(s) and auto-announces the resulting URL(s) in chat — wait for that announcement, then call the tool with `public_url` as `image_url`.
- **Path B** (Apps clients without widget UI): `request_image_upload` returns `{ upload_page_url, public_url }`. Render a download link/button for the attached image AND the `upload_page_url`; the user saves the image, drops it on the upload page in their own browser, confirms.
- **Path C** (only non-sandboxed CLI clients — Cursor, Cline, Claude Desktop, Claude Code CLI): `prepare_image_upload`, then `curl -X PUT --data-binary @<path> -H 'Content-Type: <mime>' '<upload_url>'` streams disk → R2 directly. This 403s on Claude.ai web (the egress proxy blocks object-storage hosts) — use Path A or B there.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "modify-image-1",
  "type": "modify-image",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Modify Image",
    "prompt": "",
    "provider": "gpt-image-2-6-flare-i2i",
    "negativePrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
