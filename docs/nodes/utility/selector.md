# Selector

The **Selector** node picks one item — or a subset — from an upstream list. It coexists with the per-edge selector (`outputMode: "item"`, range tab, list tab): the edge is the quick path for trivial picks, the node is what you reach for when the selection is shared across multiple downstream consumers, complex enough to deserve a label on the canvas, or needs operators the edge doesn't support (random, modulo, predicate, named-key).

```
List ──▶ Selector ──▶ DownstreamNode (uses `picked`)
                 ╰──▶ FallbackNode (uses `rest`)
```

## Inputs

| Handle | Accepts | Notes |
|--------|---------|-------|
| `in` | `text`, `image-url`, `video-url`, `audio-url`, `json` | Single list source. Multiple incoming edges concatenate in connection order. |

## Outputs

| Handle | Emits |
|--------|-------|
| `picked` | Items selected by the active mode. Always a list (1-element list for single-item modes). |
| `rest` | Items NOT selected, in source order. Partition invariants: `picked ∪ rest = in`, `picked ∩ rest = ∅`. |

Both outputs are always visible. Downstream consumers receive the first item by default; set the edge's `each` mode to fan out across the list.

## Modes

Pick one mode in the config panel. Each behaves differently:

| # | Mode | Required config | Picked size | Example |
|---|------|-----------------|-------------|---------|
| 1 | **item** | `itemIndex` (1-based: `"3"`, `"last"`, `"last-1"`) | 1 | `["a","b","c","d"]` + `itemIndex="last-1"` → picked=`["c"]`, rest=`["a","b","d"]` |
| 2 | **range** | `rangeFrom`, `rangeTo`, `rangeStep` | N | `["a","b","c","d","e"]` + from=`"2"`, to=`"4"`, step=`1` → picked=`["b","c","d"]`, rest=`["a","e"]` |
| 3 | **list** | `listExpression` (e.g., `"1,3,5..last"`) | N | `["a","b","c","d","e"]` + `"1,3,5"` → picked=`["a","c","e"]`, rest=`["b","d"]` |
| 4 | **random** | `seed` (optional), `randomCount` (default 1) | randomCount | `["a","b","c","d"]` + `seed="42"`, `randomCount=2` → deterministic 2-item pick, rest = the other two |
| 5 | **modulo** | `moduloDivisor` (literal int or `{NodeLabel}` ref) | 1 | `["a","b","c"]` + `moduloDivisor="5"` → idx = 5%3 = 2 → picked=`["c"]`, rest=`["a","b"]` |
| 6 | **predicate** | `predicateField`, `predicateOp`, `predicateValue`, `predicateMatch` (`"first"` / `"all"`), `predicateCaseSensitive` | 1 or N | items=`[{score:10},{score:20},{score:30}]` + field=`"score"`, op=`">="`, value=`"15"`, match=`"all"` → picked = items where score≥15 (b, c) |
| 7 | **named-key** | `namedKeyField`, `namedKeyValue` | 0 or 1 | items=`[{name:"hero",url:"x"},{name:"villain",url:"y"}]` + field=`"name"`, value=`"hero"` → picked = hero item |

### Per-mode notes

- **item.** Supports `"last"` and `"last-N"` for relative-from-end picks. Out-of-bounds indices clamp; malformed expressions fall back to the first item.
- **range.** Inclusive `from`/`to`. Negative step reverses (`from="last"`, `to="1"`, `step=-1` → full reverse). Step `0` is treated as `1`. Direction mismatch (e.g., forward range with negative step) returns `[]`.
- **list.** Mixes literal indices and ranges: `"1, 3..5, last"`. Duplicates and order are preserved. Malformed parts fall back to all items.
- **random.** With a non-empty `seed`, uses a deterministic `mulberry32` PRNG hashed from the seed — same seed always produces the same pick within one workflow. Empty seed → `Math.random()` (new randomness per run). Samples without replacement; `randomCount > items.length` clamps to length.
- **modulo.** Index = `divisor % items.length`. Divisor accepts `{NodeLabel}` refs — typical usage inside a Loop is `moduloDivisor="{LoopIteration}"` to cycle through a shorter list. Non-numeric or unresolvable divisor falls back to index 0.
- **predicate.** Reuses the Filter List operator set (`>`, `<`, `>=`, `<=`, `=`, `!=`, `contains`, `not_contains`, `starts_with`, `ends_with`, `regex`, `exists`, `not_exists`). `match="first"` returns only the first matching item; `match="all"` returns every match.
- **named-key.** Equivalent to `predicate(op="=", match="first")`. Surfaced as a separate mode because "look up by name" is the common shape (two fields vs predicate's three).

## Template ref interpolation

These fields accept `{NodeLabel}` refs and resolve them inline at execution time:

| Field | Mode | Why |
|-------|------|-----|
| `moduloDivisor` | modulo | Common case: `{LoopIteration}` cycles through assets |
| `predicateValue` | predicate | Mirrors Filter List's value field — compare against upstream node output |
| `namedKeyValue` | named-key | Mirrors Filter List — e.g., look up by `{CharacterName}` |
| `seed` | random | Derive a deterministic seed from upstream content (e.g., `{Project}`) |

All other fields (`itemIndex`, `rangeFrom`, `rangeTo`, `rangeStep`, `listExpression`, `randomCount`, `predicateField`, `predicateOp`, `predicateMatch`, `predicateCaseSensitive`, `namedKeyField`) are treated as literals — they're either selector-lib expressions (`"last-1"`, `"1, 3..5"`) or type-constrained (numbers, enums, JSON paths).

## Pricing

**Free — 0 credits.** Selector is pure logic that runs inline (no provider call). Available in every edition.

## Error and fallback behavior

Selector is lenient — it never fails the whole workflow on bad config. Each failure mode falls back to sensible defaults and surfaces a warning via `errorMessage` where appropriate.

| Case | Behavior |
|------|----------|
| Empty input (no upstream / upstream emits `[]`) | `picked=[]`, `rest=[]`, status `completed`, no error |
| No upstream connected | Same as empty input |
| Multiple upstreams connected to `in` | Concatenated in connection order |
| Invalid `itemIndex` expression | Falls back to first item, `errorMessage="Invalid index expression — used first item"`, status `completed` |
| Index out of bounds | Clamped to the nearest valid index |
| `predicate` matches nothing | `picked=[]`, `rest=items`, no error |
| `modulo` divisor non-numeric or unresolvable ref | Index 0, `errorMessage` set, status `completed` |
| `random` count > list length | Clamped to list length |
| `named-key` no match | `picked=[]`, `rest=items`, no error |
| Library throws unexpectedly | `status="failed"`, `errorMessage` set to the thrown message |

Contract: **`status="failed"` only on unexpected errors.** Configuration mistakes degrade gracefully — a Selector with a typo never takes down the workflow.

## When to use Selector vs. the edge selector

| Reach for the **edge selector** when… | Reach for the **Selector node** when… |
|---------------------------------------|---------------------------------------|
| Trivial single pick (`item:3`, range, list) feeding one consumer | The same selection feeds multiple downstream consumers (DRY) |
| You want the picker invisible on the canvas | The selection logic is important enough to deserve a label |
| Operator coverage is item/range/list | You need random / modulo / predicate / named-key |
| One output is enough | You want to route rejected items through `rest` |

Edge and node coexist indefinitely — the edge selector isn't being deprecated.

## Notes

- Selector emits a uniform list shape (`picked: string[]`) regardless of mode — single-item modes return a 1-element list. Downstream consumers default to the first item and opt into fan-out via the edge's `each` mode.
- Partitions are by **index**, not value. Duplicates land in the correct bucket: `["a","b","a","c"]` with `range 2..3` → `picked=["b","a"]` (indices 1, 2), `rest=["a","c"]` (indices 0, 3).
- The shared selector library powering Selector also drives the edge selector — `item` / `range` / `list` semantics are identical between the two.
