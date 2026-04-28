# @nodaro/shared

Pure-logic types, model registries, prompt templates, presentation utilities, and helpers shared across the [Nodaro](https://nodaro.ai) stack.

```bash
npm install @nodaro/shared
```

## What's in it

- **Workflow graph types** — `GenericNode`, `GenericEdge` (compatible with React Flow)
- **Provider registries** — `IMAGE_GEN_PROVIDERS`, `IMAGE_TO_VIDEO_PROVIDERS`, `TEXT_TO_VIDEO_PROVIDERS`, `TTS_PROVIDERS`, `MUSIC_PROVIDERS`, etc.
- **LLM model registry** — `LLM_MODELS`, `getLlmModel`, tiered pricing helpers
- **Prompt builders** — image prompt assembly, identity-lock clauses, template expansion
- **Presentation utilities** — `getInputNodes`, `getOutputNodes`, `getOutputType`, `INPUT_FIELD_MAP`
- **Cinematography descriptors** — camera motions, framings, lenses, lightings, aesthetics, atmospheres
- **Credit / monetization helpers** — `buildCreditModelIdentifier`, `calculateMonetizationMarkup`

## Stability

The exports are re-used by `@nodaro/client` and the official Nodaro frontend. Most consumers should depend on `@nodaro/client` and use its re-exports rather than importing from `@nodaro/shared` directly.

## License

Sustainable Use License — see the repository root LICENSE.
