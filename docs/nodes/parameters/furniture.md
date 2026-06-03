# Furniture

> Pick a furniture piece from a 78-entry catalog across 9 categories. Emits a furniture descriptor prompt fragment.

## Overview

The Furniture parameter node names a furniture object to include in a generated scene — sofa, dining table, four-poster bed, chandelier, etc. Each catalog entry carries a rich visual description that is injected into the consumer's prompt (e.g. `including a sofa, three-seater sofa with plush cushioned back...`) via the `cinematography` handle. Wire it into an AI image or video node to populate or furnish a scene.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| furniture | string | `"sofa"` | Catalog entry id (e.g. `"dining-table"`, `"chandelier"`). |
| Pre Text | text | empty | Free-form text prepended to the composed hint. |
| Post Text | text | empty | Free-form text appended to the composed hint. |

## Catalog (78 entries across 9 categories)

| Category | Examples |
|---|---|
| **Seating** | sofa, sectional-sofa, loveseat, armchair, recliner, office-chair, rocking-chair, throne, bean-bag, stool, bench, chaise-lounge, dining-chair |
| **Tables** | dining-table, coffee-table, side-table, console-table, desk, workbench, vanity-table, nightstand, picnic-table |
| **Beds** | single-bed, queen-bed, king-bed, bunk-bed, canopy-bed, four-poster-bed, daybed, crib, futon, hammock |
| **Storage** | bookshelf, wardrobe, dresser, cabinet, storage-chest, steamer-trunk, ... |
| **Lighting** | chandelier and other lighting fixtures |
| **Kitchen & Dining** | kitchen and dining furnishings |
| **Outdoor** | outdoor furniture pieces |
| **Decorative** | decorative furnishings |
| **Bath** | bathroom fixtures |

## Inputs & Outputs

**Inputs:** `in` — optional upstream parameter input.
**Outputs:** `out` — composed prompt-hint clause, consumed by downstream AI image/video nodes via their `cinematography` handle.

## Common Use Cases

- Furnish an interior scene with a specific, well-described piece.
- Add a hero object (throne, four-poster bed, chandelier) to anchor a composition.
- Keep furniture consistent across multiple generations in a workflow.

## Pricing

Free — no credits charged.

## See Also

- [Setting](./setting.md), [Material](./material.md), [Held Prop](./held-prop.md).
