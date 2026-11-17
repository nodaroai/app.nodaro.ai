/**
 * The body of a Suno cover by id (KIE's market cover model with `task_id` +
 * `audio_id` in place of the uploaded file; decided 2026-11-17) — a pure leaf,
 * so the routes and the workflow run can ask, before anything is held, whether
 * a cover can go by id at all.
 *
 * The market schema has no custom/simple switch and no description field: a
 * cover goes by id ONLY when this body says everything the upload body would
 * have. Otherwise `sunoCoverByIdInput` answers `undefined` and the run covers
 * the file, which carries the whole prompt as it always did. Nothing is ever
 * cut or dropped to make a cover fit.
 *
 *   - `lyrics` only in custom mode with vocals, and only when the request has
 *     ONE text to sing: the prompt (which the upload lane sings as lyrics
 *     there) with no lyrics field, or the lyrics field with no prompt. A
 *     custom request carrying BOTH is not expressible: the upload lane sends
 *     the prompt and a separate `lyrics` key, and which of the two it sings is
 *     not established, so the two lanes could make different songs. Lyrics
 *     left in a node's data are never sent in simple mode, nor on an
 *     instrumental.
 *   - a prompt that is not the lyrics is the style direction: sent as `style`
 *     when no style is set and it fits the model's style limit;
 *   - a prompt that is not the lyrics BESIDE a style, or one longer than the
 *     style limit: not expressible — the file lane;
 *   - `title`, `negative_tags`, `vocal_gender` as `m` / `f` (never on an
 *     instrumental), `persona_id` / `persona_model`.
 */
import { DEFAULT_SUNO_MODEL, getMaxSunoStyleChars, type SunoModel } from "@nodaro/shared/models"

export interface SunoCoverByIdParams {
  /** The generation task of the track to cover (a task made here). */
  readonly taskId: string
  /** The track's own id in that task's result. */
  readonly audioId: string
  readonly model?: SunoModel
  /** The run's prompt: lyrics in custom mode when no lyrics are set, else the style direction. */
  readonly prompt?: string
  readonly lyrics?: string
  readonly style?: string
  readonly title?: string
  readonly negativeStyle?: string
  /** "male" / "female" (the platform's spelling); sent as `m` / `f`. */
  readonly vocalGender?: string
  readonly customMode?: boolean
  readonly instrumental?: boolean
  readonly personaId?: string
  readonly personaModel?: "voice_persona" | "style_persona"
}

function genderCode(v: string | undefined): "m" | "f" | undefined {
  if (v === "male" || v === "m") return "m"
  if (v === "female" || v === "f") return "f"
  return undefined
}

/** The by-id body, an allow-list from the saved schema — or `undefined` when a cover by id cannot say what the file lane would. */
export function sunoCoverByIdInput(p: SunoCoverByIdParams): Record<string, unknown> | undefined {
  const model = p.model ?? DEFAULT_SUNO_MODEL
  const instrumental = p.instrumental ?? false
  const sung = (p.customMode ?? false) && !instrumental
  const prompt = p.prompt?.trim() || undefined
  const ownLyrics = p.lyrics?.trim() || undefined
  const ownStyle = p.style?.trim() || undefined
  // Two texts to sing: the file lane, which sends both as it always did.
  if (sung && ownLyrics && prompt) return undefined
  const lyrics = sung ? (ownLyrics ?? prompt) : undefined
  // The prompt as a direction: whenever it is not what is sung.
  const direction = sung ? undefined : prompt
  if (direction && (ownStyle || direction.length > getMaxSunoStyleChars(model))) return undefined
  const style = ownStyle ?? direction
  const gender = instrumental ? undefined : genderCode(p.vocalGender)
  return {
    task_id: p.taskId,
    audio_id: p.audioId,
    model,
    instrumental,
    ...(lyrics ? { lyrics } : {}),
    ...(style ? { style } : {}),
    ...(p.title?.trim() ? { title: p.title.trim() } : {}),
    ...(p.negativeStyle?.trim() ? { negative_tags: p.negativeStyle.trim() } : {}),
    ...(gender ? { vocal_gender: gender } : {}),
    ...(p.personaId ? { persona_id: p.personaId, persona_model: p.personaModel ?? "voice_persona" } : {}),
  }
}
