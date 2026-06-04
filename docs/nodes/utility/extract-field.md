# Extract Field

> Pull a specific field or dot-notation path from upstream JSON data.

## Overview

The Extract Field node reads structured JSON from an upstream node and extracts one field (or a path of nested fields) as its output. It has two input modes: a **Dropdown** that lists fields detected from the upstream schema, and a **Custom path** mode where you type a dot-notation path manually. The output can be a single text string, a list of items for fan-out, or a raw JSON value for chaining into another Extract Field or JSON Process node.

This node executes inline (no job created, no credits charged).

## When to Use

- Pull `title` or `url` out of a Google Search or RSS result set before feeding a List fan-out
- Extract a nested property like `authorMeta.name` from TikTok posts
- Convert a JSON array from Web Scrape into a text list for Generate Text
- Chain two Extract Field nodes to drill into deeply nested JSON

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Field | dropdown / text | `""` | The field or dot-path to extract. Empty = whole item (returns each array element as-is). Detected options appear when an upstream node is connected. |
| Mode | toggle (auto) | `dropdown` | Auto-selected. Switches to `Custom path…` for arbitrary dot-notation entry. |
| Output Type | select | `text` | How the result is emitted to downstream nodes (see below). |

### Output Type options

| Value | Behaviour |
|-------|-----------|
| `text` | Values are joined by newline into a single string. Works with any text-accepting node. |
| `list` | Each match is a separate list item — supports `item:N`, fan-out, and List-aware nodes. |
| `json` | Raw JSON value — use when feeding another Extract Field or a JSON-consuming node. |

## Inputs & Outputs

**Inputs:** Any upstream node that emits JSON, a JSON string, or a list.

**Outputs:** `text` — the extracted value(s) in the selected format.

## Pricing

Free — no credits charged.

## Common Use Cases

- Web Scrape → Extract Field (`title`) → List → Generate Image (one per headline)
- Web Scrape (RSS) → Extract Field (`url`, `list`) → Selector → text-prompt chaining
- JSON Process → Extract Field (nested path) → Generate Text
- TikTok scrape → Extract Field (`caption`) → Generate Text for remixing captions

## Tips

- Connect an upstream node first — the dropdown auto-populates with detected fields from the upstream schema, saving you from memorising key names.
- Leave **Field** blank and set **Output Type** to `list` to emit each top-level item of an array individually — useful when the JSON is already a flat list of values like `["a", "b", "c"]`.
- Use dot notation in custom mode for nested objects: `authorMeta.name`, `videoMeta.duration`.
- Chain two Extract Field nodes when the path has array segments in the middle (e.g., first extract `items`, then extract `items[].title` by chaining a second node with field `title`).
