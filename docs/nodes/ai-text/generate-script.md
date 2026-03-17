# Generate Script
> AI-powered multi-scene script generation with cinematography details, character actions, and structured scene breakdowns.

## Overview

The Generate Script node uses Gemini Flash to produce a structured, multi-scene script from a text prompt. Each scene includes a visual description, action, mood, duration hint, image prompt, and optional cinematography details (shot type, camera angle, camera movement), dialogue, location metadata, music mood, and sound effects. The output is a fully structured `GeneratedScript` object that can feed downstream image generation and video composition nodes.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Provider | `ScriptProvider` | `"gemini"` | AI model provider for script generation |
| Model | `string` | `"gemini-2.5-flash"` | Specific model version |
| Scene Count | `number` | `5` | Number of scenes to generate |
| Style Guide | `string` | `""` | Optional style directions that influence the visual and narrative style of the script |
| Structure | `"freeform" \| "8-step" \| "custom"` | `"freeform"` | Script structure template. Freeform allows the AI to decide pacing; 8-step follows a classic narrative arc |
| Tone | `string` | `""` | Optional tone descriptor (e.g., "cinematic", "playful", "dark", "documentary") |
| Target Length | `number` | `60` | Target total duration in seconds for the entire script |

## Inputs & Outputs

- **Input**: `in` -- text prompt describing the desired script topic, story, or concept
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
- Use the 8-step structure for narrative-driven content (stories, ads with arcs) and freeform for informational or documentary-style content.

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
