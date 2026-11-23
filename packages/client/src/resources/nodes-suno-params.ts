import type { SunoAddTrackModel } from "@nodaro/shared/models"

/**
 * The song and the direction shared by `nodes.run("suno-add-vocals", …)` and
 * `nodes.run("suno-add-instrumental", …)` (`POST /v1/suno/add-vocals` /
 * `/v1/suno/add-instrumental`): a new layer over the same music.
 *
 * The song is `uploadUrl` (a direct link to its audio file) or a Suno track
 * made on Nodaro (`taskId` + `audioId`, together). Every direction field is
 * optional. With no `style`, the original song's style is used when it is a
 * Suno song of your own; otherwise the call answers `400
 * suno_add_track_style`. The price does not depend on these fields.
 */
// Types, not interfaces: `nodes.run`'s body is a plain record.
export type SunoAddTrackParams = {
  /** A direct link to the song's audio file (not a page on a social site). */
  uploadUrl?: string
  /** A Suno track made on Nodaro: its task id, with `audioId`. */
  taskId?: string
  /** A Suno track made on Nodaro: its track id, with `taskId`. */
  audioId?: string
  /** Suno version (`SUNO_ADD_TRACK_MODELS`); V6 when left out. */
  model?: SunoAddTrackModel
  /** Style of the new layer: genre, mood, instruments or voice. Up to 1000 characters. */
  style?: string
  /** Title of the result (up to 80 characters); the original song's when left out. */
  title?: string
  /** Styles to keep out, comma separated. Up to 200 characters. */
  negativeTags?: string
  /** Preferred voice. Raises the chance; not guaranteed. */
  vocalGender?: "male" | "female"
  /** How closely to follow the style, 0 to 1 (steps of 0.01). */
  styleWeight?: number
  /** How far to stray creatively, 0 to 1. */
  weirdnessConstraint?: number
  /** How much the original audio weighs, 0 to 1. */
  audioWeight?: number
}

/** `nodes.run("suno-add-vocals", …)`: a sung vocal over the song. */
export type SunoAddVocalsParams = SunoAddTrackParams & {
  /** The lyrics to sing, or a direction for the voice. Sent up to 5000 characters. */
  prompt?: string
}

/** `nodes.run("suno-add-instrumental", …)`: an instrumental under the song (no prompt: direct it with `style`). */
export type SunoAddInstrumentalParams = SunoAddTrackParams
