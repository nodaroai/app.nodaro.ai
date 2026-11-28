---
node_type: long-image
generated_at: 2026-11-27T15:51:04.505Z
generated_from: 4162b88591
---

# Long Image

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `long-image`
**Category:** ai
**Credit cost:** `296` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `prompt`, `productImage1`, `productImage2`, `productImage3`, `styleImage`, `subjectImage`
**Outputs (source handles):** `image`

**Required data fields:**
- `label: string`
- `fieldMappings: FieldMappings`

**Optional data fields:**
- `mode?: LongImageMode`
- `length?: LongImageLength`
- `resolution?: LongImageResolution`
- `prompt?: string`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `currentJobId?: string`
- `currentJobProgress?: number`
- `generatedImageUrl?: string`
- `generatedResults?: readonly GeneratedResult[]`
- `activeResultIndex?: number`

**Default data:**
```json
{
  "label": "Long Image",
  "mode": "webpage",
  "length": "medium",
  "resolution": "2K",
  "prompt": "",
  "fieldMappings": {}
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

One very tall picture of a whole page, from a prompt: `mode: "webpage"` for a webpage design (wire an optional style picture into `styleImage` and a subject picture into `subjectImage`), `mode: "ecommerce"` for a product detail page (wire one to three product pictures into `productImage1`, `productImage2`, `productImage3`; `length` is `short`, `medium` or `long`). `resolution` is `1K` or `2K`.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- The prompt names the pictures it is sent: `@image_1` to `@image_3` are the pictures wired into `productImage1` to `productImage3` (a gap is closed for you), `@style` and `@subject` the webpage pictures. Every other `@` before a letter, digit or `_` (an e-mail address, a handle) is sent as the full-width `＠`, which the model does not read as a picture's name.
- Only the mode's own inputs are read: pictures wired into the other mode's inputs are not sent or charged. A product page with no product picture, or a wired picture input whose upstream made no picture, fails before anything is charged.
- The price follows the mode, length, size and the pictures sent; a run estimate counts each picture input of the mode that carries a wire, and one made without the workflow's wires counts the most the mode can send.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "long-image-1",
  "type": "long-image",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Long Image",
    "mode": "webpage",
    "length": "medium",
    "resolution": "2K",
    "prompt": "",
    "fieldMappings": {}
  }
}
```
<!-- AUTO-GEN:END examples -->
