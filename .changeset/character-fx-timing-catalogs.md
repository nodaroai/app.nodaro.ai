---
"@nodaro/prompts": minor
---

feat(character-fx): expose the character-fx node's position / duration / intensity as catalog dimensions.

The character-fx node has always had three timing parameters beside its 57-effect picker, and the platform has always owned their wording — `POSITION_CLAUSES` / `DURATION_CLAUSES` / `INTENSITY_CLAUSES` were composed into the hint at runtime. What was missing is that no consumer could *enumerate* them, so an id-only client (Studio, the SDK, MCP) had no way to offer the controls without inventing prompt text of its own. The transition node's identical gap was closed in the previous minor; character-fx was the last node with these three fields that a catalog consumer could not see.

- New exports `CHARACTER_FX_POSITIONS`, `CHARACTER_FX_DURATIONS`, `CHARACTER_FX_INTENSITIES` — graded scales in the same shape as every other catalog (id, label, description, `promptHint`, `term`), each led by a no-op `auto` whose hint is empty.
- The three clause tables AND the `CharacterFxPosition` / `CharacterFxDuration` / `CharacterFxIntensity` unions are now DERIVED from those arrays, so the clause the composer injects, the option list the API serves, and the type a consumer writes against all come from one place. The unions resolve to exactly the same members as before — no consumer change — but a step can no longer exist in one of the three and not the others.
- The `character-fx` catalog carries them as `dimensions` (the same additive shape `transition` already uses), so `GET /v1/catalogs`, `GET /v1/picker-catalogs/character-fx`, the MCP `get_picker_catalog` tool and `client.pickerCatalogs.get("character-fx")` all return the three option lists at both detail levels. A consumer reading only `options` is unaffected.
- These are the character-fx scales, not the transition ones: the ids match, but the wording is deliberately different (an effect *manifests* and *persists*; a transition *occurs* and *spans*). Read each node's own rows.

No prompt text changed: every hint is byte-identical to the clause that was already being injected.
