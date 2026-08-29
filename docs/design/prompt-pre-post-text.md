# Prompt pre & post text ("prompt affixes")

Two optional node-data fields — `promptPrefix` and `promptSuffix` — wrapped around a node's
prompt at run time, after prompt precedence and before platform assembly. Distinct from
**snippets** (text the user inserts *into* the prompt while writing) and from the **prompt**
itself: affixes are settings, invisible on the canvas and to a published app's end users.

## 1. Problem

Every AI node has one user-facing prompt field. Two things want to inject text *around* that
field without being visible in it:

- **Thin-client apps.** The app author wants a fixed opener/closer ("Cinematic 35mm still of …",
  "… golden hour, shallow depth of field") around whatever the end user types, without the end
  user seeing or editing the doctrine.
- **Presets.** A preset that ships its "special prompt" in `prompt` gets overwritten the moment
  the user types their own text (applying a preset is a partial patch over the node's data, and
  the prompt field is one text box). The preset's doctrine and the user's subject need separate
  fields.

Before this, the only workaround was concatenating on the caller's side — which the editor's
Final view cannot show, presets cannot carry, and each surface reinvents.

## 2. Decisions

| Question | Decision |
|---|---|
| Data keys | `promptPrefix`, `promptSuffix` (optional strings on node `data`) |
| Node scope | Every node with a registered prompt field **except** `text-prompt` (the plain Text input node) — 37 types: image, video, audio, music, TTS, LLM, script, vision, analysis, Suno |
| Field scope | Positive prompt only. Negative prompt untouched. |
| Where the wrap happens | Inside prompt resolution, **after** precedence (override > typed > wired) and **before** platform assembly (cinematography hints, identity clause, reference block, `Style:` / `Avoid:` suffixes). Affixes behave exactly like text the user typed. |
| Join | Smart single space (§4). A newline join was rejected — it would force formatting on authors who want a gluing suffix like `", golden hour"`. |
| Empty core | Affixes alone run (a preset may carry its whole prompt in the prefix). |
| API surface | Node-data path only: workflow JSON (API/SDK/CLI/MCP), per-run `inputOverrides`, presets. MCP generation verbs that accept a `presetId` compose the preset's affixes around the caller's prompt. **No** new `prompt_prefix` parameter on the single-shot generation routes — callers without a preset concatenate themselves (documented). |
| Editor | A collapsed **"Pre & post text"** section in the node settings panel, generic for all affix-capable nodes. Not on the node face, not in the inline prompt, not in the quick-edit modal. |
| References / snippets | The same prompt editor as the main prompt (`@` mentions, `{` variables, `/` snippets); `{Label}` refs resolved at run time with the node's ref map. Snippets are plain text — nothing extra. |
| Field mappings / `field-*` handles | Not supported on the affix fields (would add canvas handles for a settings-tier field). |
| App exposure | Not added to a published app's exposable fields — hidden from app end users by design. A per-run `inputOverrides[nodeId].promptPrefix` still reaches them for the app's own client. |
| Migration / flag | None. Additive optional fields; absent = byte-identical behaviour. |

## 3. Data model

The key names and the field type are the public contract, so they live in the Apache-licensed
shared package:

```ts
export const PROMPT_PREFIX_KEY = "promptPrefix" as const
export const PROMPT_SUFFIX_KEY = "promptSuffix" as const
export interface PromptAffixFields {
  /** Text placed BEFORE the node's prompt at run time. Supports {Node Label} refs. */
  readonly promptPrefix?: string
  /** Text placed AFTER the node's prompt at run time. Supports {Node Label} refs. */
  readonly promptSuffix?: string
}
export interface PromptAffixes { readonly prefix?: string; readonly suffix?: string }
export function readPromptAffixes(data: Record<string, unknown>): PromptAffixes
```

The *behaviour* (`applyPromptAffixes`) lives next to the prompt resolver in the prompts package.
Each affix-capable node data type intersects `PromptAffixFields`; the fields are deliberately
**not** added to any node's `defaultData`, so presets stay small and unchanged workflows stay
byte-identical.

### Registry: one source of "which nodes have a prompt"

`NODE_PROMPT_FIELDS` — the table that already knew each node's prompt field and snippet media —
moved into the prompts package so the editor, both DAG engines, the node-discovery registry, the
tests and the docs tooling read the same list. A spec entry may set `affixes: false` as an
explicit opt-out (only the plain Text node does), and one predicate gates everything:

```ts
export function nodeSupportsPromptAffixes(nodeType: string | undefined): boolean
// = a prompt-field spec exists && spec.affixes !== false
```

The settings section, the Final view, the `/v1/nodes` derivation, the totality test and the docs
sweep all ask that predicate — so a future prompt node gets affixes by registering its prompt
field, with nothing else to remember.

## 4. Semantics

```ts
export function applyPromptAffixes(
  core: string | undefined,
  affixes: PromptAffixes | undefined,
  refMap: ReadonlyMap<string, string>,
): string | undefined
export function joinPromptParts(parts: ReadonlyArray<string | undefined>): string
/** The separator between two non-blank parts ("" or " ") — the ONE join rule, shared by
 *  joinPromptParts and the Final view's segment builder. */
export function promptPartSeparator(left: string, right: string): "" | " "
```

1. **No-op guarantee.** If both affixes are absent or whitespace-only, `core` is returned
   **unchanged** (same reference, not even trimmed). This is the parity invariant for every
   existing workflow.
2. **Ref resolution.** Prefix and suffix go through the same `{Node Label}` resolution the prompt
   uses (unmatched `{…}` stays verbatim). `core` is used as given — the caller has already applied
   its own precedence and ref rules; affixes never change how the core was computed.
3. **Join.** Blank parts are dropped; between two consecutive parts a single space is inserted
   **unless** the left part already ends with whitespace, the right part starts with whitespace,
   or the right part starts with one of `, . ; : ! ? )`. Parts are otherwise not trimmed, so a
   trailing `"\n\n"` in a prefix survives and a suffix `", golden hour"` glues to the sentence.
4. **Empty core.** A blank core plus at least one affix means the joined affixes *are* the prompt.
   This intentionally displaces a node's "absent prompt" default: Image to Text with no custom
   prompt normally falls back to its default describe question; with a lone suffix, the suffix is
   the question.
5. **Precedence interplay.** Affixes wrap whichever core precedence produced — a fan-out item
   override, the typed field, or the wired upstream prompt. Where a node appends a wired prompt to
   the typed one, the core is the combined `typed. wired`, so the result is `PRE typed. wired POST`
   — never `PRE typed POST. wired`.
6. **Assembly interplay.** The wrapped string is what enters platform assembly: cinematography
   hints, the identity-lock clause, the reference-directive block, the `Style:` and `Avoid:`
   suffixes and provider truncation all apply around it exactly as they would around typed text.
   Consequence: for image models the reference block still *precedes* the prefix (it is designed to
   open the prompt), and the `Style:` suffix still follows the suffix.
7. **Negative prompt** is never affected.

### Worked examples (these are the unit-test cases)

| prefix | core | suffix | result |
|---|---|---|---|
| `"Cinematic 35mm still of"` | `"a woman in Tokyo"` | `", golden hour"` | `Cinematic 35mm still of a woman in Tokyo, golden hour` |
| `"RULES:\n- no text\n\n"` | `"a red shoe"` | — | `RULES:\n- no text\n\na red shoe` |
| — | `"a red shoe"` | `"Avoid clutter."` | `a red shoe Avoid clutter.` |
| `"Portrait of {Character}"` (ref map Character→"Mira") | `""` | — | `Portrait of Mira` |
| — | `"a red shoe"` | — | `a red shoe` (same string instance) |
| `"  "` | `"x"` | `""` | `x` (no-op) |

## 5. Where the wrap happens

There are exactly two ways a node's prompt reaches its payload, on each of the two DAG engines
(backend orchestrator and in-editor execution). The affix is applied **once per path**.

**Category A — inside the shared resolver.** `resolvePrompt` takes an optional `affixes` argument
and applies the helper to its result; the node-level helpers (`computeNodePrompt`, and the LLM
chat field builder for its *user input* branch only — never the system prompt) read the affixes
from node data and pass them through. Every caller of those helpers gets the wrap for free and
**must not wrap again**: the image/video/audio/music/speech/Suno-replace generators on both
engines, plus the video and audio prompt-assembly paths that also drive the Final view.

**Category B — bespoke read sites.** Some nodes compute their prompt with their own expression
(mostly wired-first: `resolvedInputs.prompt || data.someField`). Those expressions are wrapped in
place; precedence and the existing (lack of) ref resolution of the core are untouched. This covers
the editing/masking, motion-transfer, SFX, lip-sync, voice-description, Suno utility, script,
alignment, analysis, critic, image-to-text, motion-graphics and 3D-title lanes.

**Totality guard.** The two categories together must cover every affix-capable type exactly once,
and "exactly once" is the fragile part — a Category A helper plus a stray bespoke wrap on the same
path would double the text. So the test suite builds, for every type the registry says supports
affixes, a minimal node whose prompt field is `"X"` with `promptPrefix: "PREFIXMARK"` and
`promptSuffix: "SUFFIXMARK"`, runs it through the real payload builder, and asserts the serialized
payload contains `PREFIXMARK X SUFFIXMARK` — and each marker — **exactly once**. A new prompt node
that forgets its wrap fails that test the day it is registered; the plain Text node is the negative
case.

### The Final view

The editor's Final view shows the assembled prompt with each piece tinted by provenance. The
affixes get their own origin ("Pre/post text", teal) and are composed at the same point the run
composes them: the image path applies them to the resolved user text (plus any wired prompt)
*before* hints and the identity clause, mirroring the resolver; the video and audio paths inherit
it from Category A; provider-less nodes wrap the resolved user text. A parity test asserts the
preview string is byte-identical to what the payload builder sends.

## 6. Editor UI

A single generic **Pre & post text** section in the node settings panel, mounted once and
rendering nothing unless `nodeSupportsPromptAffixes(nodeType)`:

- Collapsible and **collapsed by default**, with a small "set" badge (1–2) when either field is
  non-blank — a hidden affix is never invisible in settings.
- Two prompt editors, **Before the prompt** and **After the prompt**, with the same `@` references,
  `{` variables and `/` snippet pool as the node's main prompt.
- One caption: "Wrapped around the prompt at run time — including a wired or fan-out prompt — and
  shown in the Final view."
- Nothing on the node face, in the inline prompt, or in the quick-edit modal. Undo and the preset
  dirty-star treat them as ordinary data fields.

## 7. Presets and apps

- **Capture** is automatic: preset extraction strips only the excluded/execution keys, so the
  affixes ride along with every other setting. **Apply** is the existing partial patch — a preset
  with affixes sets them, a preset without leaves the node's current ones (consistent with every
  other field).
- **MCP generation verbs with a `presetId`** compose after the `{ ...presetParams, ...callerProvided }`
  merge: if the preset carries affixes, the caller's `prompt` is wrapped with them (no graph, so an
  empty ref map — `{…}` stays verbatim). The "a prompt is required (or pass a presetId whose preset
  includes one)" guard runs *after* composition, so an affixes-only preset passes by the empty-core
  rule. The caller's prompt still beats a preset prompt; affixes come only from the preset.
- **Apps** keep the affixes out of the exposable input fields — end users never see them. The
  per-run path is `inputOverrides: { [nodeId]: { promptPrefix, promptSuffix } }` on the app-run
  endpoint, which merges arbitrary node data keys. To make that pattern real on every surface, the
  SDK's `apps.run(slug, inputs, { inputOverrides })`, the MCP `run_app` `inputOverrides` argument
  and the CLI's `--override <nodeId>.<field>=<value>` all reach it.
- **Generate Script exception.** Its editor prompt field is the Style Guide, but the run-time
  prompt is the wired/typed script topic — that is what both engines send. Affixes wrap the
  run-time prompt, so for Generate Script they wrap the topic, not the Style Guide. The totality
  test carries a one-entry override map for it and the node page says so.

See also: [Prompt pre & post text](../prompt-pre-post-text.md) (user-facing reference),
[prompt-snippets](./prompt-snippets.md), [Presets](../nodes/presets.md).
