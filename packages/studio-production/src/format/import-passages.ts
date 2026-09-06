import type { ProductionDocument } from "./schema"

/**
 * THE ONE LIST OF BINDABLE PROSE FIELDS — the reader every stage of the import
 * pipeline enumerates passages with, and the WRITER beside it.
 *
 * Split out of `import.ts` (D41) purely so the canonicalizer can rewrite the
 * very fields the resolver reads without importing the pipeline it is a stage
 * of: `import.ts` is the top of this folder's module graph and every sibling is
 * a leaf, so the alternative was a cycle. The field list stays ONE list — a
 * second copy of it in a rewriter is exactly how a passage comes to be bound
 * but not canonicalized, or canonicalized but never bound.
 */

/**
 * The binding key of ONE prose field — the same string on both sides of the
 * resolve → map handoff, so a scene's chips can never land on its neighbour.
 */
export function promptKey(
  sceneIndex: number,
  field: "frame" | "motion" | `shot:${number}`,
): string {
  return `${sceneIndex}.${field}`
}

/**
 * Every prose field a mention can BIND in, with the key its bindings land
 * under — ONE list, read by `resolveMentions` and by the summary's
 * `countMentions` alike (B12). The gate keys on the count, so a field
 * counted here but not bound (or bound but not counted) would make the gate
 * lie about the very thing it guards.
 */
export function bindablePassages(
  doc: ProductionDocument,
): ReadonlyArray<{ readonly key: string; readonly text: string }> {
  const out: Array<{ key: string; text: string }> = []
  const add = (key: string, text: string | undefined) => {
    if (text) out.push({ key, text })
  }
  doc.scenes.forEach((scene, i) => {
    add(promptKey(i, "frame"), scene.frame?.prompt)
    add(promptKey(i, "motion"), scene.motion?.prompt)
    scene.shots?.forEach((shot, n) => add(promptKey(i, `shot:${n}`), shot.text))
  })
  return out
}

/**
 * The same passages, rewritten — the WRITE side of {@link bindablePassages},
 * copy-on-write down to the scene: a document (and every node in it) whose
 * prose the rewriter leaves alone comes back as the SAME object, so a stage
 * that changes nothing costs nothing downstream.
 *
 * A guard test pins the pair against each other, because the only thing keeping
 * the two halves in step is that they sit here together.
 */
export function mapBindablePassages(
  doc: ProductionDocument,
  rewrite: (text: string) => string,
): ProductionDocument {
  let moved = false
  const scenes = doc.scenes.map((scene) => {
    let next = scene
    const frame = scene.frame
    if (frame?.prompt) {
      const prompt = rewrite(frame.prompt)
      if (prompt !== frame.prompt) next = { ...next, frame: { ...frame, prompt } }
    }
    const motion = scene.motion
    if (motion?.prompt) {
      const prompt = rewrite(motion.prompt)
      if (prompt !== motion.prompt) next = { ...next, motion: { ...motion, prompt } }
    }
    if (scene.shots) {
      let shotsMoved = false
      const shots = scene.shots.map((shot) => {
        if (!shot.text) return shot
        const text = rewrite(shot.text)
        if (text === shot.text) return shot
        shotsMoved = true
        return { ...shot, text }
      })
      if (shotsMoved) next = { ...next, shots }
    }
    if (next !== scene) moved = true
    return next
  })
  return moved ? { ...doc, scenes } : doc
}
