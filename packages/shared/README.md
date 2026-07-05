# @nodaro/shared

Pure-logic types, the model catalog, wire contracts, structural vocabularies
(asset types, attach columns, picker/i18n infrastructure), presentation
utilities, and credit estimators shared across the [Nodaro](https://nodaro.ai)
stack — the **Apache-2.0, embed-anywhere layer**.

The creative layer — prompt hints, picker catalogs, prompt builders, factory
presets/snippets — lives in [`@nodaro/prompts`](https://www.npmjs.com/package/@nodaro/prompts)
under the Functional Source License (free for non-competing use).

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

The exports are re-used by `@nodaro/sdk` and the official Nodaro frontend. Most consumers should depend on `@nodaro/sdk` and use its re-exports rather than importing from `@nodaro/shared` directly.

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
