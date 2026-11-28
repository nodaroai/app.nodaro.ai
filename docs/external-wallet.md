# Deployment shared wallet

A cloud deployment with a designated payer can authorize customer spending through its own wallet. The deployment's prepaid pool still pays for platform usage. The external wallet controls each customer's available budget across products.

Single-node requests and workflow nodes check the deployment payer's prepaid pool before reserving against the customer's external wallet. The customer's local credit balance is not a spending requirement. An insufficient deployment pool can prevent a wallet reserve call; the wallet's reserve decision remains authoritative for the customer's shared budget.

Configure `DEPLOYMENT_WALLET_URL`, `DEPLOYMENT_WALLET_TOKEN` and `DEPLOYMENT_WALLET_SSO_PROVIDER` together on the API and workers. The URL must use HTTPS. The token is a dedicated server secret. `DEPLOYMENT_WALLET_TIMEOUT_MS` defaults to 10000 and accepts 1000–30000. Leave all three authority settings unset to retain existing billing. Local per-user allowance enforcement must be off; incompatible configuration refuses activation.

The endpoint accepts POST JSON with `unit: "nodaro_credit"`. Every request uses `contract: 1` unless an admin has turned on **Enforce unpaid charges** in Admin → Video route (off by default). Only then do routed video reservations, settlements with a verified overage, and installment reads use contract 2. Authenticate `Authorization: Bearer <token>`. Never interpret these credits as another product's tokens without an explicit conversion owned by the external wallet.

## Reserve

```json
{
  "contract": 1,
  "unit": "nodaro_credit",
  "action": "reserve",
  "operation_id": "a3354131-4e5e-43a6-8f61-3914f09c658e",
  "job_id": null,
  "user_id": "5bf0d884-47b1-468e-a7b2-2433f957b267",
  "sso_provider": "partner",
  "sso_subject": "customer-123",
  "model_identifier": "example-model",
  "reserved_credits": 30
}
```

Use `sso_subject` to identify the customer. It comes from trusted server-managed authentication metadata. `operation_id` identifies a usage record; a job or workflow can contain multiple records. Atomically reserve the requested amount against the shared available budget before answering:

```json
{"contract":1,"unit":"nodaro_credit","operation_id":"a3354131-4e5e-43a6-8f61-3914f09c658e","decision":"allow","reserved_credits":30}
```

For insufficient funds or an ineligible account, answer HTTP 200 with the same envelope and `decision: "deny"` (no amount required). Service errors use non-2xx responses. Timeout, malformed response, mismatched amount/ID, missing identity and denial all prevent provider dispatch. Request `Idempotency-Key` is `<operation_id>:reserve`.

## Settle or release

The same operation fields are sent with `action: "settle"` and `actual_credits`. Charge exactly that amount and release the rest of the reservation. Zero releases everything. Reply:

```json
{"contract":1,"unit":"nodaro_credit","operation_id":"a3354131-4e5e-43a6-8f61-3914f09c658e","settled":true,"actual_credits":12}
```

The terminal request key is `<operation_id>:settle`. Delivery is at least once; retries must return the original result without another debit. Reject conflicting identity, reservation ceiling or final amount for the same operation.

**Settlement can precede a delayed reserve.** A zero settlement must create a permanent terminal record even if the operation is not yet known. A subsequent reserve must never reopen it. Reservations have no automatic expiry: generation and human review can outlive HTTP requests. Keep holds until settlement and retain idempotency records. Never release an active hold merely because a callback is late.

The local ledger records settlement and its outbox together. Normal settlement attempts delivery immediately; a minute-based worker retries with backoff up to one hour. Unacknowledged events remain durable. Never remove wallet configuration or point it to another wallet while operations remain open. Rotate the token on the same authority. Operators should monitor `external_wallet_operations` for undelivered terminal records and aged active holds; the table and RPCs are service-role-only. Existing job recovery owns authorized running jobs; the wallet recovery worker safely cancels only reservations that were never authorized.

## Routed video and later top-ups

A routed video's final verified cost can exceed its initial hold. This section applies only while **Enforce unpaid charges** is on in Admin → Video route. While it is off (the default), a wallet sees the version 1 contract for every operation, routed video included: a reserve, then one terminal `settle` that captures at most the hold. The part of a verified cost above the hold is recorded on the platform and raised as an alert to its operators; the wallet is asked for nothing more.

Turn enforcement on for a wallet deployment after its wallet implements the following contract. A version 1 wallet continues to serve ordinary operations. With enforcement on, a routed reserve that the wallet cannot authorize returns an error before video submission.

For a routed reserve, the request uses the existing reserve fields and idempotency key, with `"contract": 2` and `"capability": "routed_debt_v1"`. Before answering `allow`, the wallet must support collection against future top-ups. Its response must echo version 2, the capability, operation ID, unit, and exact reserved amount. A denial echoes version 2, operation ID and unit with `"decision": "deny"`. Preserve the operation ID across versions and retries. A retry can only refer to the original hold. The terminal `settle` captures at most the original hold and releases unused credits.

When a verified charge exceeds the hold, the terminal `settle` request uses contract 2 and the same `<operation_id>:settle` key. It carries the original operation fields, `actual_credits` equal to the hold, and a positive `original_shortfall` for the excess. Atomically capture the hold and register one obligation for that exact amount and subject. A repeated terminal request must return the original result. Reject conflicting amounts or identities. Once registered, apply available customer credits and future top-ups to the outstanding obligation before making them available for new paid runs. Serialize collection, grants and spending for that subject. Create one permanent, provider-unique receipt for each positive whole-credit installment in the same transaction as its debit. The service keeps the terminal event open until capture and registration are both acknowledged.

```json
{"contract":2,"unit":"nodaro_credit","operation_id":"a3354131-4e5e-43a6-8f61-3914f09c658e","sso_provider":"partner","sso_subject":"customer-123","settled":true,"actual_credits":30,"debt_registered":true,"original_shortfall":18}
```

After this acknowledgement, the service sends `sync_debt` to read verified installments. Each read carries the original operation identity and overage. Its credit offset is how much of that overage the service has already recorded.

When a run delivers no acceptable video, its zero settlement releases the hold before capture. Post-capture refunds are unsupported for external-wallet usage. The original capture and subsequent repayments stay recorded. Clearing a local debt record would leave the partner's obligation active.

```json
{
  "contract": 2,
  "unit": "nodaro_credit",
  "action": "sync_debt",
  "operation_id": "a3354131-4e5e-43a6-8f61-3914f09c658e",
  "job_id": "381dbe98-2ba4-4c43-b19c-130642e267a9",
  "user_id": "5bf0d884-47b1-468e-a7b2-2433f957b267",
  "sso_provider": "partner",
  "sso_subject": "customer-123",
  "model_identifier": "example-model",
  "reserved_credits": 30,
  "original_shortfall": 18,
  "after_credits": 6
}
```

1. Locate the obligation already registered at settlement. Verify the original operation, identity, ceiling, settled amount and overage. Reject unknown or conflicting obligations.
2. Return the **first** installment after the exact `after_credits` boundary. A repeat read at that boundary must return the same confirmed receipt. If no next payment exists yet, echo the obligation with `"receipt": null`. A later read at the same boundary can then return a new receipt. An offset within an installment or beyond the collected total is invalid.

```json
{
  "contract": 2,
  "unit": "nodaro_credit",
  "operation_id": "a3354131-4e5e-43a6-8f61-3914f09c658e",
  "sso_provider": "partner",
  "sso_subject": "customer-123",
  "original_shortfall": 18,
  "after_credits": 6,
  "receipt": {"id": "payment-842", "credits": 8}
}
```

In this example, the next read asks for `after_credits: 14` and four credits remain. A receipt ID is a nonempty string of at most 200 characters. A read can return a new installment as funds arrive, so it has no HTTP idempotency key. The worker retries missing or invalid replies and records each verified payment once. While the customer has an unpaid balance, new paid runs are blocked. The deployment's prepaid platform pool is tracked separately. Wallet operators must implement and test this extension on their endpoint before activating routed reservations.

## Balance

```json
{"contract":1,"unit":"nodaro_credit","action":"balance","user_id":"5bf0d884-47b1-468e-a7b2-2433f957b267","sso_provider":"partner","sso_subject":"customer-123"}
```

```json
{"contract":1,"unit":"nodaro_credit","sso_subject":"customer-123","available_credits":250}
```

Available credits exclude all outstanding holds across products. This balance may be fractional so a remainder smaller than one billable credit can still be displayed; reserve/settle amounts are whole credits. The studio converts the balance once into its configured display unit and removes the separate local allowance display. Before activation, agree the conversion and configure `billing.unitRate`/`unitLabel` to match the external product's budget, so both products show the same figure. An unavailable balance appears as unknown. Connected MCP clients read the same figure: `check_balance` answers the wallet's available amount in the display unit, and an unavailable balance as `null`, never `0` ([MCP tools](mcp/tools.md#deployment-unit)). The reserve operation remains authoritative when simultaneous requests race.

## Price discovery

`GET /v1/deployment-billing/pricing` requires the payer's billing integration key or session. `creditCost` is a base tariff; `creditIdentifier` names the billed identifier and `pricingBasis` explains the default. Text models are billed per model: `creditIdentifier` is the model's Generate Text price key (`llm-chat:<model>`, with `:direct` when the default call runs on the vendor's own API) and `creditCost` its **estimate** — a typical call, charged its actual usage per token — so the row and each such `pricing` entry carry `estimate: true` (show it as approximate, `≈N`). Their `pricing` entries list the model's per-operation keys the same way; Workflow Copilot, Content Recipe and Content Ideas still bill a tier row and carry no `estimate`. A model with no price on its lane is listed in `missing`. A text model's `isEnabled` and `category` come from the `llm-chat` row, the switches its reservation checks. Media variants resolve through effective configured prices; missing variant prices remain null with an error code. On a deployment running the tier-pricing rollback, text models use `llm-chat` tier identifiers at default settings and nothing carries `estimate`.

`denomination` states the credit unit and display conversion. `purchaseOptions` lists standard USD top-ups with their effective USD-per-credit rates. Separate commercial terms may apply. Settings, quantity, duration and measured usage can change the final charge; use the reservation and settlement amounts for accounting, not a catalog base tariff. Prefer a full request with `If-None-Match` for change detection: `since` tracks price-row timestamps and cannot detect every runtime configuration change.
