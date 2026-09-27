---
"@nodaro/shared": patch
"@nodaro/sdk": patch
---

Listed prices are now the prices a run is charged. `GET /v1/models` (`client.models.list()`), `GET /v1/nodes` (`client.nodes.list()` / `get()`) and the MCP `list_models` tool serve the same credits as the node's Run button, where they used to list the catalog's base price. The field docs say so: `PriceVariant.credits` is the catalog's list price, and the SDK's `pricing` and `creditCost` are the charged price.
