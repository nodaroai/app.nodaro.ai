# Deployment shared wallet

A cloud deployment with a designated payer can authorize customer spending through its own wallet. The deployment's prepaid pool still pays for platform usage. The external wallet controls each customer's available budget across products.

Single-node requests and workflow nodes check the deployment payer's prepaid pool before reserving against the customer's external wallet. The customer's local credit balance is not a spending requirement. An insufficient deployment pool can prevent a wallet reserve call; the wallet's reserve decision remains authoritative for the customer's shared budget.

Configure `DEPLOYMENT_WALLET_URL`, `DEPLOYMENT_WALLET_TOKEN` and `DEPLOYMENT_WALLET_SSO_PROVIDER` together on the API and workers. The URL must use HTTPS. The token is a dedicated server secret. `DEPLOYMENT_WALLET_TIMEOUT_MS` defaults to 10000 and accepts 1000–30000. Leave all three authority settings unset to retain existing billing. Local per-user allowance enforcement must be off; incompatible configuration refuses activation.

The endpoint accepts POST JSON with `contract: 1` and `unit: "nodaro_credit"`. Authenticate `Authorization: Bearer <token>`. Never interpret these credits as another product's tokens without an explicit conversion owned by the external wallet.

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

## Balance

```json
{"contract":1,"unit":"nodaro_credit","action":"balance","user_id":"5bf0d884-47b1-468e-a7b2-2433f957b267","sso_provider":"partner","sso_subject":"customer-123"}
```

```json
{"contract":1,"unit":"nodaro_credit","sso_subject":"customer-123","available_credits":250}
```

Available credits exclude all outstanding holds across products. This balance may be fractional so a remainder smaller than one billable credit can still be displayed; reserve/settle amounts are whole credits. The studio converts the balance once into its configured display unit and removes the separate local allowance display. Before activation, agree the conversion and configure `billing.unitRate`/`unitLabel` to match the external product's budget, so both products show the same figure. An unavailable balance appears as unknown. The reserve operation remains authoritative when simultaneous requests race.

## Price discovery

`GET /v1/deployment-billing/pricing` requires the payer's billing integration key or session. `creditCost` is a base tariff; `creditIdentifier` names the billed identifier and `pricingBasis` explains the default. Text models use `llm-chat` at default settings; their `pricing` entries list operation-specific identifiers. Media variants and text operations resolve through effective configured prices; missing variant prices remain null with an error code.

`denomination` states the credit unit and display conversion. `purchaseOptions` lists standard USD top-ups with their effective USD-per-credit rates. Separate commercial terms may apply. Settings, quantity, duration and measured usage can change the final charge; use the reservation and settlement amounts for accounting, not a catalog base tariff. Prefer a full request with `If-None-Match` for change detection: `since` tracks price-row timestamps and cannot detect every runtime configuration change.
