---
"@nodaro/shared": minor
---

Adds the transient-key list the public share read strips: `STUDIO_TRANSIENT_KEYS`, `STUDIO_SHOT_TRANSIENT_KEYS` and the pure `stripStudioTransientSettings`.

The list has two readers — the public share read of a workflow, and the production writer's own bundle projection — and a second copy of it does not stay equal: it goes one key stale, and the stale side is the one that publishes. So it lives here, once.
