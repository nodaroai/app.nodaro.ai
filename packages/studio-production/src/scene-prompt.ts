/**
 * The scene's GENERIC PROMPT and the directing body are ONE prompt: the scene
 * description leads, as its own paragraph.
 *
 *     <scenePrompt>\n\n<timed windows | directing prose>
 *
 * Both directions live here because a take stores the SUBMITTED string. Selecting
 * a past take restores that string into the composer AND its scene prompt beside
 * it — so without the exact inverse of the fold, the paragraph would be prepended
 * to a body that already opens with it, and double on the next render (the same
 * fold-twice class as the baked-clause recovery).
 */

/** The paragraph break between the scene prompt and the body it leads. */
const SEPARATOR = "\n\n"

/** Scene prompt + body → the one prompt. Empty either side folds to the other. */
export function foldScenePrompt(
  scenePrompt: string | undefined,
  body: string,
): string {
  const scene = (scenePrompt ?? "").trim()
  if (!scene) return body
  const tail = body.trim()
  return tail ? `${scene}${SEPARATOR}${tail}` : scene
}

/**
 * The inverse: a stored prompt minus the scene paragraph it was folded with.
 * CONSERVATIVE — anything not shaped exactly like {@link foldScenePrompt}'s
 * output is handed back untouched, so a prompt that merely opens with the same
 * words keeps every one of them.
 */
export function stripScenePrompt(
  prompt: string,
  scenePrompt: string | undefined,
): string {
  const scene = (scenePrompt ?? "").trim()
  if (!scene) return prompt
  const body = prompt.trimStart()
  if (!body.startsWith(scene)) return prompt
  const rest = body.slice(scene.length)
  if (!rest.trim()) return ""
  return rest.startsWith(SEPARATOR) ? rest.slice(SEPARATOR.length) : prompt
}
