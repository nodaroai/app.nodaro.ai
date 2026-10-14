/**
 * Reading direction for text a USER or AUTHOR wrote (a sticky note, a prompt,
 * a template or app description, a text output) — as opposed to UI chrome,
 * which follows the locale through `<html dir>`.
 *
 * Authored text is in whatever language its author typed, not the viewer's
 * locale: a Hebrew note in an English UI laid out LTR moves its final
 * punctuation to the wrong edge and scrambles mixed Hebrew/Latin runs. The
 * fix is the platform's own — `dir="auto"`, which takes the direction from
 * the text's first strong character and bidi-isolates it from its neighbours.
 *
 * Where to put it:
 *   - multi-line prose block (`<p>`, a pre-wrap `<div>`) → `dir="auto"` on the
 *     block, so its alignment follows the content too;
 *   - a short name or label inside a row → wrap only the text:
 *     `<span dir="auto">{name}</span>`, so punctuation and isolation are right
 *     while the row keeps the UI's alignment;
 *   - an editable `<input>` / `<textarea>` → `dir={editableTextDir(value)}`.
 *     An EMPTY field shows a translated placeholder (chrome); leaving `dir`
 *     unset while empty lets that placeholder keep the UI direction.
 *   - a TWO-LAYER editor (a transparent textarea over a highlighted mirror,
 *     like `TagTextarea`) → `dir={textDirOf(value)}` on BOTH layers. `auto`
 *     would let each layer pick its own direction from its own content, and
 *     the mirror's content is pills and thumbnails, not the raw text — the
 *     caret would then sit on a different line edge than the text it edits.
 *
 * Never on a layout container (a flex/grid row): `dir` is inherited and
 * mirrors the whole subtree (see `components/nodes/node-text-dir.ts`).
 * Guarded by `components/__tests__/user-text-dir.test.tsx`.
 */
export function editableTextDir(value: string | null | undefined): "auto" | undefined {
  return value && value.trim() ? "auto" : undefined
}

/** Letters of the scripts written right to left (bidi classes R and AL). */
const RTL_LETTER = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}]/u
const LETTER = /\p{L}/u

/**
 * The direction `dir="auto"` would pick, as an explicit value: the text's
 * first letter decides (digits, punctuation, spaces and symbols are neutral
 * and skipped). No letter at all — empty, or only digits and symbols —
 * gives `undefined`, so the element keeps the UI direction (and an empty
 * field's placeholder is not flipped).
 *
 * `skip` removes spans that are not the author's prose before the first
 * letter is looked for — a prompt box passes its reference tokens
 * (`{image:1}`, `{Person}`), which it draws as pills, so a Hebrew prompt that
 * opens with a reference still reads right to left.
 */
export function textDirOf(
  text: string | null | undefined,
  skip: readonly RegExp[] = [],
): "rtl" | "ltr" | undefined {
  if (!text) return undefined
  const prose = skip.reduce((acc, re) => acc.replace(new RegExp(re.source, "g"), " "), text)
  const first = LETTER.exec(prose)
  if (!first) return undefined
  return RTL_LETTER.test(first[0]) ? "rtl" : "ltr"
}
