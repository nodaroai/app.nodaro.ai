---
node_type: generate-image
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written
---

# generate-image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `generate-image`
**Category:** ai
**Credit cost:** 1-8 (varies by provider; see `generate_image` MCP tool for current pricing)
**Inputs (target handles):** `in`
**Outputs (source handles):** `image`

**Required data fields (config):**
- `label: string`
- `prompt: string`
- `provider: string` — `"nano-banana-pro"` is the default; full enum varies, surfaced by the `generate_image` tool's `provider` parameter
- `model: string`
- `style: string` (empty string OK)
- `aspectRatio: string` (e.g., `"16:9"`)
- `negativePrompt: string` (empty string OK)
- `fieldMappings: Record<string, string>` (`{}` if no input wiring)

**Required result fields (when attaching a completed generation):**
- `executionStatus: "completed"` (literal string)
- `generatedImageUrl: string` — exact field name (NOT `imageUrl`, NOT `result.url`, NOT `outputUrl`)

**Recommended result fields:**
- `generatedResults: [{ url, jobId, timestamp }]`
- `activeResultIndex: 0`
- `currentJobId: string`

**Default data:**
```json
{ "label": "Generate Image", "prompt": "", "provider": "nano-banana-pro", "model": "gemini-2.5-flash-image", "style": "", "aspectRatio": "16:9", "negativePrompt": "", "fieldMappings": {} }
```
<!-- AUTO-GEN:END node-data-shape -->

<!-- AUTO-GEN:START mcp-call -->
**MCP tool:** `generate_image`

Call the tool, capture `result.url` (or whichever URL field the response uses), and write it into `data.generatedImageUrl` when attaching the node via `update_workflow_json`.
<!-- AUTO-GEN:END mcp-call -->

## When to use

Text-to-image generation. For trailer / cinematic flows, embed character + location descriptions directly in the prompt rather than pre-generating separate character / location nodes (which would require types outside the strict 8-node whitelist).

## Common gotchas

- Field name is `generatedImageUrl` — NOT `imageUrl`, `outputUrl`, or `result.url`. The frontend reads only `generatedImageUrl` (or `generatedResults[].url`); anything else renders an empty placeholder.
- `executionStatus: "completed"` is REQUIRED for the node to mark itself complete and propagate downstream. The image itself will still render via the URL fallback chain (`activeResult?.url ?? generatedImageUrl ?? url`), but status badges, downstream wiring, and "run from here" will treat the node as incomplete without it.
- For 4K output, only `nano-banana-pro` currently supports it.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "scene-1",
  "type": "generate-image",
  "position": { "x": 680, "y": 0 },
  "data": {
    "label": "Shot 1 — Scene",
    "prompt": "Determined runner late 20s, olive jacket, dark jeans, sun-dappled pine forest clearing at golden hour, wide shot",
    "provider": "nano-banana-pro",
    "model": "gemini-2.5-flash-image",
    "style": "",
    "aspectRatio": "16:9",
    "negativePrompt": "",
    "fieldMappings": {},
    "executionStatus": "completed",
    "generatedImageUrl": "https://r2.nodaro.ai/jobs/abc123/output.png",
    "generatedResults": [
      { "url": "https://r2.nodaro.ai/jobs/abc123/output.png", "jobId": "abc123", "timestamp": "2026-05-18T12:00:00Z" }
    ],
    "activeResultIndex": 0,
    "currentJobId": "abc123"
  }
}
```
<!-- AUTO-GEN:END examples -->
