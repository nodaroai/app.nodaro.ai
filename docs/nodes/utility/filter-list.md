# Filter List

> Keep only the list items that match one or more conditions.

## Overview

The Filter List node filters an upstream list down to the items that satisfy a set of conditions. Each condition tests a field (by dot-path) with an operator — equals, contains, greater than, matches regex, is in list, and more — and conditions can be combined with AND/OR logic. A live preview shows the shape of the first upstream item and highlights which fields your conditions read. It is ideal for narrowing scraped or generated lists before fan-out.

## How it works

- Connect a list-producing node upstream (List, Split Text, JSON Process, a web-scrape source, etc.).
- Add one or more conditions. For each: choose a field (detected from the upstream schema or a custom dot-path), an operator, and a value.
- Choose whether conditions are combined with **AND** (all must match) or **OR** (any must match).
- The node returns only the items that pass.

## Operators

`equals`, `not equals`, `contains`, `does not contain`, `starts with`, `ends with`, `greater than`, `less than`, `is empty`, `is not empty`, `matches regex`, `is in list`.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Conditions | List | `[]` | Field + operator + value tests applied to each item |
| Condition Logic | Select | `AND` | Combine conditions with AND (all) or OR (any) |

## Inputs & Outputs

**Inputs:** A list from an upstream node.

**Outputs:** The filtered list (items that passed the conditions).

## Pricing

Free — no credits charged.
