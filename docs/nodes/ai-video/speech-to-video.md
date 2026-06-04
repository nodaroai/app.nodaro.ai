# Speech to Video

> Generate video driven by speech audio input using Wan 2.2.

## Overview

The Speech to Video node creates video content driven by speech audio. It uses Wan 2.2 to generate visual content that corresponds to the spoken input, offering fine-grained control over generation parameters.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Resolution | Select | 720p | Output resolution: 480p, 580p, 720p |
| Prompt | Textarea | — | Scene description to guide visuals |
| Negative Prompt | Textarea | — | Elements to exclude |

### Advanced Settings (Collapsible)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Seed | Number | Random | Fixed seed for reproducibility |
| Num Frames | Number | — | Frame count: 16-81 |
| FPS | Number | — | Frames per second: 8-24 |
| Inference Steps | Number | — | Quality steps: 1-50 |
| Guidance Scale | Number | — | Prompt adherence: 0-20 |
| Shift | Number | — | Shift parameter: 0-20 |

## Inputs & Outputs

**Inputs:**
- Audio (required) — speech audio track
- Image (optional) — reference image

**Outputs:**
- Generated video URL
## Best Practices

- Use clear, well-recorded speech audio for best results
- Provide a descriptive prompt alongside the audio for better visual control
- Start with default advanced settings and adjust only if needed
- Higher inference steps improve quality but increase generation time

## Common Use Cases

- Create video presentations driven by narration
- Generate animated content from podcast audio
- Build speech-synchronized visual content
- Create talking character animations from audio

## Tips

- 480p (3cr) is great for quick previews; 580p (5cr) is a middle option; use 720p (6cr) for final output
- Increase inference steps for more detailed results at the cost of longer processing
- The Guidance Scale controls how closely the output follows your prompt — higher values are more faithful but less creative
