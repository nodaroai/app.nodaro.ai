---
"@nodaro/prompts": minor
---

Minor-age floor (Layer 1): catalog entries across the person, styling, mood, pose, and photo-genre families carry an `adultOnly` flag (survives pack projection). `isMinorAge()` is an adult allow-list — custom age under 20, teen buckets, and minor-implying types are minors by default, so a new age id starts inside the floor. The person and styling fragment collectors drop `adultOnly` entries for a minor subject at the point each hint is resolved. `getAdultOnlyIds()` exposes the flagged id set (drives the picker-ui hide+clear); `getAdultOnlyHintStrings()` exposes the flagged prompt-hint strings (drives the backend prompt policy that strips them from free text). `applyMinorAgeFloorToPickerValues()` is a picker-value post-filter for analyzer/import paths.

Adds two exports for the free-text case, where a client sends an already-assembled prompt and no structured picker value survives: `getMinorAgeHintStrings()` (the prompt hints of every minor age entry and every minor-implying type, read through the pack-composed catalog funnel) and `containsMinorAgeHint(text)` (those hints word-bounded, plus a numeric age below 20 in any shape `buildAgeFragment` emits, plus "in their teens"). Deliberately never a bare-word check — a prompt that merely mentions a child is not a minor-subject prompt.

`containsMinorAgeHint(text)` also reads the colloquial spellings a human or an LLM writes rather than the ones `buildAgeFragment` emits — `aged 12`, `age 12`, `at the age of 12`, `12yo`, `12 y.o.`, `12 y/o`, `12 yr old`, `12-yr-old`, `12yrs old`, `12 years of age` — all on the same `< 20` cut.

Adds `buildNeedleAlternationSource(needles)`: the word-bounded needle matcher both layers of the floor build from, with each phrase's tokens joined by `[\s-]+` so a catalog phrase is matched however the carrying text spaced or hyphenated it (still requiring at least one separator, so it never widens into a substring rule). `ADULT_SWEPT_CATALOG_IDS` and `FLOORED_PICKER_KEYS` are exported, the latter derived from the former so the picker-value strip list can never be a subset of the flag sweep.

Adult output is unchanged.
