/**
 * What a caller needs to know about a node type's app input that its coarse
 * type does not say (`get_app_inputs`' `description`).
 *
 * The Video URL node reads as a `video` input, but takes a LINK. A post link
 * (YouTube, TikTok, Instagram, Facebook, X) is not a file: a run from the app's
 * own page brings the file along (its card downloads the post first), and every
 * other lane — MCP, the SDK, the API — gets it downloaded by the server before
 * the nodes that need the file run (decided 2026-10-08), under the card's rules:
 * a YouTube video under 4 minutes whole, a longer one only as the part the node
 * names (sectionStartSec / sectionEndSec), because nobody is there to choose.
 * A node that reads only the sound (Transcribe, Suno Cover) gets just the sound.
 */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  "youtube-video":
    "A link to a video: a YouTube, TikTok, Instagram, Facebook or X post, or any other public web link to a video file. " +
    "A post link is downloaded for the run before the nodes that need the video file start; when only the sound is needed " +
    "(Transcribe, Suno Cover) only the sound is fetched. A YouTube video of 4 minutes or more is downloaded only as a part " +
    "(inputOverrides sectionStartSec and sectionEndSec, in seconds, on this node) - without one the run is refused before " +
    "anything is charged; or send a link to the file itself.",
}

export function appInputDescription(nodeType: string): string | undefined {
  return Object.hasOwn(DESCRIPTIONS, nodeType) ? DESCRIPTIONS[nodeType] : undefined
}
