---
node_type: modify-image
generated_at: 2026-08-29T19:02:38.439Z
generated_from: 7dbf4818b
---

# Modify Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `modify-image`
**Category:** ai
**Credit cost:** 2
**Inputs (target handles):** `image`, `mask`, `cinematography`
**Outputs (source handles):** `out`

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
  "provider": "nano-banana",
  "negativePrompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

Image-to-image: edit / transform / restyle / outpaint / inpaint (`modify_image` over MCP). Call `list_models { kind: "image", mode: "i2i" }` or `mode: "edit"` for the capability sheets.

### Model guidance

- **`nano-banana-pro`** — best overall and best for face/character identity preservation across multi-turn edits (up to 14 reference images, ~5 distinct characters); also leads on text/typography. First pick when in doubt.
- **`nano-banana-2`** (default) — very good consistency, faster and cheaper than Pro.
- **`gpt-image-2`** — strong for typography / logos / text-heavy edits and prompt-adherence-critical work.
- **`ideogram-remix`** — character-aware, good for stylized remix.
- **`seedream-edit`** — high-res output for instruction-style edits.
- **`recraft-remove-bg`** — background removal, no prompt (`list_models` shows its credits).
- **Avoid `flux-kontext`** for general use — it degrades quickly across multi-turn edits; only for one-shot texture-heavy edits, and even then prefer Nano Banana Pro.

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
- `aspect_ratio`
- `negative_prompt`
- `structured`
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
    "provider": "nano-banana",
    "negativePrompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
