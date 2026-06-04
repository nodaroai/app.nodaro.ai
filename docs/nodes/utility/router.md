# Router

> Conditionally split workflow execution into one or more named routes.

## Overview

The Router node passes its upstream input to one or more named output routes. It has three modes:

- **Radio** — exactly one route is active at a time; you pick it in the config panel. The selected route's downstream nodes execute; all others are skipped.
- **Checkbox** — any combination of routes can be active simultaneously; you toggle each on or off. All active routes execute in parallel.
- **Conditional** — routes are activated at runtime based on field-value conditions evaluated against the upstream data. Each condition group targets one or more routes; multiple groups union their results.

Routes can be renamed. New routes are added up to a maximum of 10.

## When to Use

- Toggle between two generation pipelines (e.g., "portrait" vs "landscape") without disconnecting edges
- Run different post-processing paths depending on a QA check pass/fail result
- Build A/B content variations by activating multiple routes simultaneously
- Gate downstream nodes behind a data condition (e.g., skip the dubbing path if `language === "en"`)

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Mode | select | `radio` | `Radio` (one active), `Checkbox` (many active), or `Conditional` (data-driven) |
| Routes | list | Route A, Route B | Named routes; each maps to an output handle. Add up to 10. |

### Radio / Checkbox mode

Each route has a toggle (radio) or checkbox in the config panel. Activate or deactivate routes interactively before running the workflow.

### Conditional mode

Condition groups evaluate the upstream JSON. Each group has:

| Sub-field | Description |
|-----------|-------------|
| Conditions | One or more field/operator/value rules combined with AND or OR logic |
| Condition Logic | `AND` (all must match) or `OR` (any must match) |
| Target routes | Which routes are activated when this group matches |

Multiple groups union their results — a route is activated if any matching group targets it. Supported operators include `=`, `!=`, `contains`, `not_contains`, `starts_with`, `ends_with`, `>`, `<`, `>=`, `<=`, `regex`, `exists`, `not_exists`.

## Inputs & Outputs

**Inputs:** `in` — upstream data (text, JSON, image URL, video URL, audio URL).

**Outputs:** One output handle per route (e.g., `route_a`, `route_b`). The upstream value is forwarded unchanged to every active route's downstream nodes.

## Pricing

Free — no credits charged.

## Common Use Cases

- QA Check → Router (conditional: `score > 0.8` → "publish" route, else "regenerate" route)
- Radio mode to switch between a "reel" (9:16) and "post" (1:1) formatting branch
- Checkbox mode to generate a video and a thumbnail simultaneously from the same source image
- Conditional mode driven by an upstream Generate Text output to branch on extracted keywords

## Tips

- In radio mode, exactly one route is active at any time; switching the selection before a run changes which downstream branch executes.
- In conditional mode the upstream data must be JSON (or a text value that parses as JSON). Wire a Web Scrape or JSON Process node upstream if you need structured data to condition on.
- A route with no downstream nodes is effectively a no-op — execution skips it silently.
- Route names are cosmetic only; they appear as output handle labels on the canvas.
