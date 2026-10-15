---
"@nodaro/sdk": minor
"@nodaro/cli": minor
"@nodaro/shared": patch
---

Outbound webhooks: register an https endpoint and your server is POSTed every `job.completed` / `job.failed` of your account instead of polling `jobs.get()` — signed, retried with backoff for about 43 hours, every attempt in a delivery log. `client.webhooks` — `create` (returns the endpoint's `whsec_…` signing secret, this once), `list`, `get`, `update` (address, events, description, switch on/off), `delete`, `rotateSecret` (a new secret; the old one keeps signing beside it for a grace period, a day by default, `gracePeriodSeconds: 0` to end it at once), `deliveries` (the log), `getDelivery` (one delivery by id) and `test` (a ping) — over the new `/v1/webhook-endpoints` routes, plus `verifyWebhookSignature` (and `WebhookSignatureError`) to check a delivery's `Nodaro-Signature` header on the raw body with Web Crypto (Node 20+, edge runtimes, browsers). Nothing changes for an app that does not register an endpoint. OAuth app tokens need `jobs:read`, and an endpoint registered with an app's token receives only the jobs that app submitted. CLI: `nodaro webhooks list | get | create | update | delete | rotate-secret [--grace <seconds>] | deliveries | test [--wait]`.

`@nodaro/shared`: `isPrivateOrReservedIP` (and `isLocalOrPrivateHostname`) now refuse the whole of link-local `fe80::/10` (it matched only `fe80:`), site-local `fec0::/10`, local-use NAT64 `64:ff9b:1::/48`, Teredo `2001::/32` and the IPv4 `192.0.0.0/24`, and judge NAT64 `64:ff9b::/96` and 6to4 `2002::/16` addresses by the IPv4 address they reach. Anything with a colon that is not a valid IPv6 address is refused.
