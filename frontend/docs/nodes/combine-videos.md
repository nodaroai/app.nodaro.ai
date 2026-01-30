# Combine Videos

## Overview

Processing node that merges multiple video clips into a single video.

## When to Use

- Combine scene clips into a final video
- Merge branching video outputs

## Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| videos | video[] | Yes | Video clips to combine (accepts multiple connections) |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| video | video | The combined video |

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| transition | select | cut | Transition type (cut, fade, dissolve) |
| transitionDuration | number | 0.5 | Transition duration in seconds |

## Credit Cost

2 credits per execution.
