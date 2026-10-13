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
 *
 * Never on a layout container (a flex/grid row): `dir` is inherited and
 * mirrors the whole subtree (see `components/nodes/node-text-dir.ts`).
 * Guarded by `components/__tests__/user-text-dir.test.tsx`.
 */
export function editableTextDir(value: string | null | undefined): "auto" | undefined {
  return value && value.trim() ? "auto" : undefined
}
