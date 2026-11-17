# Suno Cover
> Create a cover version of an existing audio track using Suno AI.

## Overview

Suno Cover takes a source audio track and generates a new cover version of it. You can customize the output with different lyrics, style tags, vocal gender, and model selection. The source audio can be provided via a direct URL or connected from an upstream node.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | string | `""` | Description of how the cover should differ from the original. Max length is per-version: **5000** for the V6 family (V6 / V6_WILD / V6_MINI) and V4.5 / V4.5PLUS / V4.5ALL / V5 / V5.5, **3000** for V4; **3000** in non-custom mode on every version. Over-long input is truncated to the model's limit — the editor warns first. |
| Source Audio URL | URL | `""` | URL of the source audio to cover. Can be connected from an upstream node. A link to where a video is goes in through a Video URL node, which asks for the content rights declaration and fetches its sound: given here directly, a run in the editor stops and says so. |
| Model | enum | `"V6"` | Suno model version: `V6` (greater musical expression, more natural vocals, richer details), `V6_WILD` (bolder, more distinctive, less predictable), `V6_MINI` (lightweight and fast), `V5_5`, `V5`, `V4_5PLUS`, `V4_5ALL`, `V4_5`, `V4`. |
| Title | string (max 80) | `""` | Title for the cover version. |
| Lyrics | string | `""` | Custom lyrics for the cover. Supports Suno metatags. Same per-version max as Prompt. |
| Style | string (max 1000) | `""` | Genre and style tags for the cover. Max **1000** for V6 / V4.5+ / V5, **200** for V4. |
| Negative Style | string (max 500) | `""` | Styles to avoid in the cover. |
| Vocal Gender | enum | auto | `"male"`, `"female"`, or unset for automatic selection. |
| Custom Mode | boolean | `false` | Enables advanced parameter control. |
| Instrumental | boolean | `false` | When true, generates an instrumental cover (removes vocals). |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the prompt at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Cover by id

A cover is made from its audio file: whatever is wired into the node or passed as `uploadUrl` is covered exactly as it always was, a song made with Suno here included.

On the API and MCP you can instead name one of your own Suno songs by its ids alone — `taskId` and `audioId`, with no `uploadUrl` — and Suno covers it by those ids, with nothing uploaded again. The price is the same. This works when all of these hold:

- the song is your own: a finished run on your account made it (Create Music, Extend, Cover, Upload Extend, Mashup, Replace Section, Add Vocals or Add Instrumental), and `audioId` is one of the tracks that run returned;
- the cover's settings fit a cover by id. By id there is no separate prompt field: in Simple mode the prompt is sent as the style; in Custom mode the prompt is sung as the lyrics. So a prompt beside a style, a prompt longer than a style may be (1,000 characters; 200 on V4) when it is the style, and a Custom cover with both lyrics and a prompt cannot go by id.

Nothing is ever shortened or dropped to make a cover go by id: a request that does not fit is refused before the run starts, with nothing charged, and tells you to pass the audio instead. The output of a run that went by id carries `coverLane: "id"`.

`POST /v1/suno/cover` takes `uploadUrl`, or `taskId` with `audioId` (both or neither), or all three. Whenever `uploadUrl` is present the file is covered and the ids are not used. Refused before the run starts, with nothing charged, for ids with no `uploadUrl`:

- ids of another account's song (`suno_task_not_yours`);
- ids of a task no run here made, of a Suno task that is not a song, of a song that is not finished, an `audioId` that is not one of the song's tracks, or settings that do not fit a cover by id (`suno_cover_source`).

## Inputs & Outputs

- **Inputs:** `in` -- source audio URL from an upstream audio node
- **Outputs:** `audio` -- generated cover audio URL
## Best Practices

- Provide a clear prompt describing the target style for the cover (e.g., "acoustic folk version" or "80s synthwave remix").
- Use the Instrumental toggle to create karaoke-style versions of songs.
- Supply custom lyrics if you want to change the words, not just the musical style.
- Pair with Suno Separate first to isolate vocals or instrumentals from the source before covering.
- Iterate quickly on `V6_MINI`, then re-run the version you like on `V6` for the final output.

## Common Use Cases

- Reimagining a track in a completely different genre.
- Creating instrumental or karaoke versions of existing songs.
- Changing vocal gender on an existing track.
- Producing style variations of a Suno Create Music output.
- Building a workflow where generated music feeds into a cover for iterative refinement.

## Tips

- The source audio must be accessible via a public URL. Connect an upstream Suno Create Music or upload node to provide it automatically.
- Custom Mode unlocks fine-grained control over style interpretation.
- Negative Style is particularly effective for covers -- use it to prevent the AI from retaining unwanted elements of the original.
