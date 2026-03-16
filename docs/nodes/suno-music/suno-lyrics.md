# Suno Lyrics
> Generate song lyrics from a text prompt using Suno AI.

## Overview

Suno Lyrics generates structured song lyrics from a descriptive prompt. The output includes both a generated title and full lyrics text, complete with Suno metatags for section markers. This node is commonly used upstream of Suno Generate to produce lyrics before song creation.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Prompt | string (max 1000) | `""` | Description of the desired lyrics (theme, mood, topic, style). Supports style tag autocomplete. |

## Inputs & Outputs

- **Inputs:** `in` -- optional upstream text connection
- **Outputs:** `text` -- generated lyrics text (includes `generatedTitle` and `generatedText`)

## Credit Cost

- **Fixed:** 2 credits

## Best Practices

- Be specific about the theme, mood, and story in your prompt for more coherent lyrics.
- Mention the desired song structure in the prompt (e.g., "two verses, a chorus, and a bridge") to guide the output.
- Connect the output directly to a Suno Generate node's lyrics field for an automated lyrics-to-song pipeline.
- Use the generated metatags (`[Verse]`, `[Chorus]`, etc.) as-is -- Suno Generate understands them natively.
- Keep prompts under 1000 characters; focus on concept rather than verbatim text.

## Common Use Cases

- Pre-generating lyrics before feeding them into Suno Generate.
- Brainstorming song concepts and getting structured lyrical output.
- Creating lyrics for a specific theme or narrative (love song, protest anthem, lullaby).
- Building a workflow: Suno Lyrics -> Suno Style Boost -> Suno Generate.
- Generating multiple lyric variations by running the node with different prompts.

## Tips

- The output contains two fields: `generatedTitle` (a suggested song title) and `generatedText` (the full lyrics with metatags).
- At 2 credits, this is one of the most cost-effective Suno nodes -- use it freely for exploration.
- The prompt field supports style tag autocomplete in the editor for convenience.
- Pair with Suno Style Boost to enhance the generated lyrics before song creation.
