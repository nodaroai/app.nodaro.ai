# Generate Script
> AI-powered multi-scene script generation with cinematography details, character actions, and structured scene breakdowns.

## Overview

The Generate Script node uses Gemini Flash to produce a structured, multi-scene script from a text prompt. Each scene includes a visual description, action, mood, duration hint, image prompt, and optional cinematography details (shot type, camera angle, camera movement), dialogue, location metadata, music mood, and sound effects. The output is a fully structured `GeneratedScript` object that can feed downstream image generation and video composition nodes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | `ScriptProvider` | `"gemini"` | AI model provider for script generation |
| Model | `string` | `"gemini-2.5-flash"` | Specific model version |
| Advanced mode | `boolean` | `false` | Gemini models only. Runs the model on the provider's own API so **Temperature**, **Max Tokens** and the full reasoning-depth range actually apply — those controls appear once it is on. Bills one credit tier up, capped at premium; the node's cost badge updates immediately. Disabled with an inline reason on non-Gemini models |
| Scene Count | `number` | `5` | Number of scenes to generate, 1 to 20 |
| Style Guide | `string` | `""` | Optional style directions for the writing, the visuals and the pacing. Sent to the model with the topic. Supports `{Node Label}` references |
| Tone | `string` | `""` | Optional tone descriptor (e.g., "cinematic", "playful", "dark", "documentary"), up to 200 characters. Can come from a Tone or Text node connected to the **Tone** input |
| Target Length | `number` | `60` | Target total duration in seconds for the entire script, 5 to 600 |
| `promptPrefix` / `promptSuffix` | text | -- | Optional pre/post text wrapped around the script prompt (not the Style Guide) at run time (settings panel → **Pre & post text**; hidden from app users; captured by presets). See [Prompt pre & post text](../../prompt-pre-post-text.md). |

## Inputs & Outputs

- **Input**: `prompt` -- the topic, story or concept, from a connected Text node (or any text output). A run with no topic stops before it starts and names the missing input; no credits are charged.
- **Settings inputs** -- each sets one panel field at run time, over what is typed there (the field shows the connected node and can't be edited while it is connected):
  - `field-tone` (**Tone**) -- a Tone node or any text.
  - `field-styleGuide` (**Style Guide**) -- a Style Guide node or any text.
  - `field-sceneCount` (**Scene Count**) -- a Scene Count node.
  - `field-targetLength` (**Duration**) -- a Duration node (the target length).

A value that comes from a connected source is fitted to its field: a longer tone is cut to 200 characters, a number given as text becomes a whole number within the field's range, and a value that is not a number leaves the field at its default.
- **Output**: `scenes` -- structured `GeneratedScript` object containing title, total duration, and array of `ScriptScene` objects

### ScriptScene Fields

| Field | Type | Description |
|-------|------|-------------|
| sceneNumber | `number` | Sequential scene index |
| sceneName | `string` | Short name for the scene |
| visualDescription | `string` | Detailed description of what is seen |
| action | `string` | What happens in the scene |
| mood | `string \| string[]` | Emotional tone(s) |
| durationHint | `number` | Suggested duration in seconds |
| imagePrompt | `string` | Ready-to-use prompt for image generation |
| characters | `ScriptSceneCharacter[]` | Characters with name, description, mood, action, position |
| dialogue | `ScriptSceneDialogue[]` | Spoken lines with speaker, text, emotion |
| location | `ScriptSceneLocation` | Name, description, time of day, weather, lighting |
| cinematography | `ScriptSceneCinematography` | Shot type, camera angle, camera movement |
| musicMood | `string` | Suggested background music mood |
| soundEffects | `string[]` | Suggested sound effects |
## Best Practices

- Provide a clear, specific prompt. "30-second product ad for a fitness app showing morning routine" produces better results than "make a video."
- Use the Tone field to set the emotional register. It is applied globally across all scenes and helps maintain consistency.
- Set Scene Count based on your target duration -- roughly one scene per 5-10 seconds works well for most video formats.
- The Style Guide field is useful for maintaining visual consistency. Include details about color palette, era, or visual references.

## Common Use Cases

- Generating multi-scene storyboards for video production
- Creating structured scripts for explainer videos
- Building scene-by-scene plans for animated content
- Producing shot lists with cinematography directions
- Generating image prompts for each scene in a video project

## Tips

- The output `imagePrompt` per scene is designed to be fed directly into a Generate Image node. Connect the script output to downstream image nodes via the scene index.
- Scene character data includes structured fields (name, mood, action, position) that can be mapped to Character and Scene nodes for advanced workflows.
- The `cinematography` field provides shot type, camera angle, and camera movement suggestions that inform downstream video composition.
- Scripts can be imported into Scene nodes via the `mapScriptSceneToNodeData()` utility function, which maps all structured fields including characters, dialogue, locations, and cinematography.
- Target Length is advisory -- the AI distributes the duration across scenes but individual scene durations may vary based on content complexity.
