# Image to Video

## Overview

AI node that converts a static image into a video clip with motion.

## When to Use

- Animate generated images into video scenes
- Create video clips from reference images

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| image | image | Yes | Source image to animate |
| motion-prompt | string | No | Description of desired motion |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| video | video | The generated video clip |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| provider | select | VEO | AI provider (VEO, Kling, Runway, Pika) |
| model | string | veo-3.1 | Model identifier |
| duration | number | 5 | Clip duration in seconds |
| motion | select | moderate | Motion intensity (subtle, moderate, dynamic) |
| cameraMotion | select | static | Camera movement type |

## Credit Cost

20 credits per execution.
