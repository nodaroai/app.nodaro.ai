# Sort List

> Sort the items of a list by value or by a field, with text/number/date comparison.

## Overview

The Sort List node orders an upstream list. You can sort whole items or sort by a field within each item (dot-path), choose how values are compared (Auto, Text, Number, or Date), and pick ascending or descending direction. Items with missing or invalid values always sort last, regardless of direction.

## How it works

- Connect a list-producing node upstream (List, Split Text, JSON Process, a web-scrape source, etc.).
- Choose **Sort by field**: `(whole item)` to sort full strings, a detected field from the upstream schema, or a custom dot-path (e.g. `score`, `created_at`). Items are parsed as JSON when the path resolves against them.
- Choose a **Sort type**: Auto (tries Number → Date → Text), or an explicit Text / Number / Date for deterministic ordering.
- Choose **Direction**: Ascending or Descending.
- The node returns the sorted list, with a preview of the first items.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Sort by field | Select / dot-path | `(whole item)` | Field to sort by. Blank = sort whole items. |
| Sort type | Select | `auto` | Comparison: Auto / Text / Number / Date |
| Direction | Toggle | `asc` | Ascending or Descending |

## Inputs & Outputs

**Inputs:** A list from an upstream node.

**Outputs:** The sorted list.

## Pricing

Free — no credits charged.
