# Deduplicate

> Remove duplicate items from a list, keeping the first occurrence.

## Overview

The Deduplicate node takes an upstream list and removes duplicates, preserving the order of the first occurrence of each item. By default it compares whole items as strings; you can instead deduplicate by a field within each item (useful when the list is made of JSON objects, e.g. scraped records keyed by `id` or `url`).

## How it works

- Connect a list-producing node upstream (List, Split Text, JSON Process, Filter List, a web-scrape source, etc.).
- Choose **Deduplicate by field**: pick `(whole item)` to compare full strings, select a detected field from the upstream schema, or enter a custom dot-path (e.g. `id`, `metadata.url`).
- The node walks the list, computes a uniqueness key per item, and drops any item whose key has already been seen.
- The output is the deduplicated list (a pass-through list that downstream list-aware nodes can iterate).

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Deduplicate by field | Select / dot-path | `(whole item)` | Field used to compute the uniqueness key. Blank = compare whole items as strings. |

## Inputs & Outputs

**Inputs:** A list from an upstream node.

**Outputs:** The deduplicated list.

## Pricing

Free — no credits charged.
