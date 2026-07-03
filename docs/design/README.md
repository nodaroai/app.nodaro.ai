# Design Notes

This folder collects a curated set of **design documents** written during Nodaro's development — the kind of "why it works this way" notes that usually live in an engineer's head or a private wiki. We publish them because the *reasoning* behind a system is often more useful than the code alone: the constraints, the alternatives considered, the edge cases, and the invariants that keep things correct.

They read like lightweight RFDs (cf. [Oxide's RFDs](https://rfd.shared.oxide.computer/), Rust RFCs). Each captures a real feature at the moment it was designed.

**Read them as design intent, not as current API reference.** These are point-in-time documents — a few predate refactors, and some file paths or field names have since moved. The code and the public [`docs/`](../) are the source of truth for how the system behaves today. Where a doc and the code disagree, the code wins.

## Workflow engine & execution

| Doc | What it covers |
|-----|----------------|
| [array-input-fan-out](./array-input-fan-out.md) | Fan-out semantics (`each`/`all`/`last`/`item:N`), zip-by-index, cancellation, partial-failure refunds |
| [external-call-reconciliation](./external-call-reconciliation.md) | Recovering jobs stuck at an external provider — idempotent compare-and-set finalize, per-provider staleness thresholds, stall-retry idempotency |
| [smart-progress-bars](./smart-progress-bars.md) | EMA-based progress estimation, outlier guards, a non-linear progress curve, weighted multi-node aggregation |
| [router-node](./router-node.md) | Conditional control-flow routing between branches of a workflow |
| [sub-workflow-node](./sub-workflow-node.md) | Nested workflows as a reusable structural primitive |
| [reduce-fan-in](./reduce-fan-in.md) | Fan-in / reduce across fanned-out branches (shipped as the `reduce` node) |
| [generate-script-multi-handle](./generate-script-multi-handle.md) | Multi-handle output nodes, output dedup, backward compatibility |
| [sync-node-job-persistence](./sync-node-job-persistence.md) | Job persistence wiring and race-condition safety |

## Nodes & canvas UX

| Doc | What it covers |
|-----|----------------|
| [mobile-app-shell](./mobile-app-shell.md) | Mobile shell architecture — iOS keyboard/safe-area handling, edge cases |
| [table-node-presentation-sizing](./table-node-presentation-sizing.md) | Table/presentation node display and responsive sizing rules |
| [image-editor-integration](./image-editor-integration.md) | Embedding an image editor (lazy-load, save flow, theming) |
| [video-editor-project-persistence](./video-editor-project-persistence.md) | `postMessage` protocol + object-storage snapshot persistence for the embedded video editor |
| [model-search-select](./model-search-select.md) | A reusable model picker with drift-resistance built in |
| [picker-catalogs-public-contract](./picker-catalogs-public-contract.md) | Treating the curated picker catalogs as a stable public contract |

## Prompting

| Doc | What it covers |
|-----|----------------|
| [prompt-wizard](./prompt-wizard.md) | A wizard that structures prompt *output*, not content; reference-role weaving |
| [prompt-snippets](./prompt-snippets.md) | Reusable inline prompt fragments — data model, API, pill display layer |

## Characters, entities & references

| Doc | What it covers |
|-----|----------------|
| [unified-asset-references](./unified-asset-references.md) | One reference model across characters, locations, objects, and creatures |
| [unified-reference-roles](./unified-reference-roles.md) | Reference *roles* registry — how a referenced asset is used in a prompt |
| [character-sheet](./character-sheet.md) | Character sheet redesign, driven by an adversarial design audit |
| [character-studio](./character-studio.md) | Character studio redesign — source modes, voice panel |
| [character-node-role-and-lock](./character-node-role-and-lock.md) | Default reference role + identity-lock on the character node |
| [entity-studios-parity](./entity-studios-parity.md) | Bringing creature/location studios to parity with characters |
| [animal-creature-entity](./animal-creature-entity.md) | Modeling animals/creatures as a first-class entity type |

## Marketplace & sharing

| Doc | What it covers |
|-----|----------------|
| [component-marketplace](./component-marketplace.md) | Reusable workflow components — queued sub-execution, cycle detection, depth limits, snapshot immutability |
| [component-marketplace-preview](./component-marketplace-preview.md) | The marketplace preview modal — UX, accessibility, interaction edge cases |
| [community-sharing](./community-sharing.md) | Sharing entities across the community — data model, RLS, route projection discipline |

## AI orchestration & skills

| Doc | What it covers |
|-----|----------------|
| [film-director-skill](./film-director-skill.md) | A conversational "film director" skill that assembles an editable workflow on the canvas in real time |
| [skill-architecture](./skill-architecture.md) | Auto-generating node skill docs from types (ts-morph) with a CI drift gate |
