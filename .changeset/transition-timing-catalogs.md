---
"@nodaro/prompts": minor
"@nodaro/cli": patch
---

feat(transitions): expose the transition node's position / duration / intensity as catalog dimensions.

The transition node has always had three timing parameters beside its 82-entry picker, and the platform has always owned their wording — `POSITION_CLAUSES` / `DURATION_CLAUSES` / `INTENSITY_CLAUSES` were composed into the hint at runtime. What was missing is that no consumer could *enumerate* them, so an id-only client (Studio, the SDK, MCP) had no way to offer the controls without inventing prompt text of its own.

- New exports `TRANSITION_POSITIONS`, `TRANSITION_DURATIONS`, `TRANSITION_INTENSITIES` — graded scales in the same shape as every other catalog (id, label, description, `promptHint`), each led by a no-op `auto` whose hint is empty.
- The three clause tables AND the `TransitionPosition` / `TransitionDuration` / `TransitionIntensity` unions are now DERIVED from those arrays, so the clause the composer injects, the option list the API serves, and the type a consumer writes against all come from one place. The unions resolve to exactly the same members as before — no consumer change — but a step can no longer exist in one of the three and not the others.
- The `transition` catalog carries them as `dimensions`, and `projectPickerCatalog` now keeps `dimensions` on a single-dim catalog instead of dropping them — additive, so a consumer reading only `options` is unaffected. The catalog-summary `optionCount` counts both, and the CLI's `catalog-snapshot` includes them so `diff-upstream` can see them change.
- The editor's transition panel now renders these dropdowns from the catalogs instead of a hand-written copy that had already drifted (it showed `Short (~1s)` where the catalog said `Short`). The precision moved into the catalog labels, so the editor and an id-only client show the same text.

No prompt text changed: every hint is byte-identical to the clause that was already being injected, which the parameter-hint golden fixture verifies.
