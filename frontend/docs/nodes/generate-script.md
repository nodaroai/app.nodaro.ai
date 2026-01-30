# Generate Script

## Overview

AI node that generates structured scripts/storyboards from text prompts.

## When to Use

- Convert a story concept into structured scenes
- Generate scene-by-scene breakdowns for video production

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | Yes | Story concept or description |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| scenes | array | Structured scene descriptions |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| provider | select | Gemini | AI provider (Gemini, Claude, GPT) |
| model | string | gemini-2.5-flash | Model identifier |
| sceneCount | number | 5 | Number of scenes to generate |
| structure | select | freeform | Script structure (freeform, 8-step, custom) |
| tone | string | "" | Desired tone/mood |
| targetLength | number | 60 | Target video length in seconds |

## Credit Cost

2 credits per execution.
