/**
 * What a node's `provider` value names, as a model restriction judges it —
 * the rule lives in `@nodaro/render-rules` (`provider-model.ts`) so the
 * editor's model menus judge a row the same way the door and the run do: an
 * engine name (Generate Music's `minimax`, Motion Transfer's `kling`) is the
 * model it runs, or no catalog model, never a model that shares its id.
 *
 * The deny at the door (the credit guard's raw-provider check and the
 * workflow build's named-model check, both asked on every deployment) judges
 * `provider` only when it names the model itself (`providerIsItsModel`). The
 * model an engine name runs is judged where a run's model is judged — the
 * route's `runModel` and the build's default-model judge — which only ask on
 * a deployment that restricts models. So a deployment that restricts nothing
 * sees only fewer refusals: an engine name that shares an id with a model an
 * admin switched off no longer refuses the node.
 *
 * The resolved-model registry (`job-resolved-model.ts`) reads the same
 * functions for these jobs. `__tests__/provider-model-census.test.ts` fails a
 * node type whose provider vocabulary is not the ids of the models it runs and
 * that has no entry (or a reason there).
 */
export { PROVIDER_MODEL_OF_NODE, providerIsItsModel, providerModelOf, type ProviderModel } from "@nodaro/render-rules"
