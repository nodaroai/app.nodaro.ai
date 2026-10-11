/**
 * What a self-host says about its nodaro.ai connection, in one place: the
 * near-end routes (`routes/nodaro-exclusive.ts`), the relay worker and the
 * cloud client all answer with these words, so a refusal reads the same
 * whichever path — the route, a workflow run, a relayed job — reached it.
 */

/** The code a route answers (503) when the install must connect, or reconnect. */
export const NODARO_CONNECTION_REQUIRED_CODE = "nodaro_connection_required"

/** No connection at all. */
export const NODARO_CONNECTION_REQUIRED_MESSAGE =
  "This node runs on nodaro.ai. Connect your install (Integrations → nodaro.ai, or paste an API key from app.nodaro.ai → Settings → API) and run again."

/** nodaro.ai refused the install's credential (401/403): revoked or expired. */
export const NODARO_CONNECTION_REJECTED_MESSAGE =
  "The nodaro.ai connection was rejected — it may have been revoked. Reconnect from Integrations."
