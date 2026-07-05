# @nodaro/prompts

The prompt-engineering layer of the [Nodaro](https://app.nodaro.ai) AI video
platform: the person / picker catalogs **with their prompt hints**,
identity-lock clauses, entity prompt builders, brand presets, and the
prompt/reference assembly used by the Nodaro backend, editor, and
[`@nodaro/sdk`](https://www.npmjs.com/package/@nodaro/sdk) (which depends on
this package and re-exports its most useful helpers).

## License — read this first

**[FSL-1.1-Apache-2.0](./LICENSE)** (Functional Source License), NOT Apache:

- **Free for any non-competing use** — including embedding in your commercial
  applications built against the Nodaro platform, internal use, education,
  and research.
- **Not licensed for Competing Use** — you may not use it in a product or
  service that competes with Nodaro or offers substantially similar
  functionality.
- Each version becomes **Apache-2.0 two years** after its release.

The structural, embed-anywhere layer (types, wire contracts, model catalog,
asset vocabularies) lives in [`@nodaro/shared`](https://www.npmjs.com/package/@nodaro/shared)
under Apache-2.0.
