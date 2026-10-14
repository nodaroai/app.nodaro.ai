---
node_type: site-capture
generated_at: 2026-10-14T09:07:44.166Z
generated_from: 7b7338d2d
---

# Site Capture

<!-- AUTO-GEN:START node-data-shape -->
**Type:** `site-capture`
**Category:** input
**Credit cost:** `11` charged on Nodaro Cloud — the price a run is charged is `GET /v1/credits/model-cost?model=<model id>` (MCP: `list_models`); `GET /v1/nodes` gives this node's figure live.
**Inputs (target handles):** `in`
**Outputs (source handles):** `image`, `json`

**Required data fields:**
- `label: string`

**Optional data fields:**
- `url?: string`
- `maxStills?: number`
- `executionStatus?: "idle" | "running" | "completed" | "failed"`
- `errorMessage?: string`
- `generatedJson?: unknown`
- `__listResults?: string[]`
- `lastRunOutcome?: "success" | "failed"`
- `lastRunAt?: number`
- `lastRunStartedAt?: number`

**Default data:**
```json
{
  "label": "Site Capture",
  "url": "",
  "maxStills": 8
}
```
<!-- AUTO-GEN:END node-data-shape -->

## When to use

To put a real web page on screen in a video or a design: a product's landing
page, a pricing table, a feature section. The node loads the page in a phone
browser and returns up to 8 section stills (phone-card shaped, in page order)
on `image`, and the whole capture on `json` — the full-page image, the section
map (each section's label, category and text) and the page's exact figures
(`facts`: prices, counts, ratings, as the page writes them).

Wire `image` with an **Each** wire to run the next node once per still (Image
to Text, an animation), or a **Bundle** wire to hand every still to a node that
takes a list (Slideshow, Image Collage). A plain wire hands on the first still.

<!-- AUTO-GEN:START mcp-call -->
<!-- AUTO-GEN:END mcp-call -->

## Common gotchas

- **The page comes from `url`, or from `in`.** Leave `url` empty to take the
  first web address in the text wired into `in` (a Text node, a list of
  addresses on an Each wire, one capture per address).
- **A capture takes up to a few minutes.** The route answers with a job id at
  once and the run polls it; the editor and the workflow runner do this on
  their own.
- **Some pages refuse.** A page that walls the visit (a bot challenge, a 403 or
  429), shows nothing, cannot be reached, or whose robots.txt disallows it fails
  the node with that reason, and the capture is refunded.
- **Fewer stills than asked.** `maxStills` is a ceiling: a page with fewer
  sections gives fewer, and a still that renders blank is skipped (the
  capture's `warnings` say which).
- **Available where capture is enabled on the install** (`SITE_CAPTURE_ENABLED`,
  on by default). Elsewhere the node is not offered and the route answers 404.

<!-- AUTO-GEN:START examples -->
## Worked example

```json
{
  "id": "site-capture-1",
  "type": "site-capture",
  "position": {
    "x": 0,
    "y": 0
  },
  "data": {
    "label": "Site Capture",
    "url": "",
    "maxStills": 8
  }
}
```
<!-- AUTO-GEN:END examples -->
