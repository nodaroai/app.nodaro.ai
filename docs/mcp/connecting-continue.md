# Connecting Continue.dev

## Steps

1. Open VS Code (or your JetBrains IDE) with the Continue extension installed
2. Open Continue's `config.json` (Cmd+Shift+P → "Continue: Open Config")
3. Add a new entry under `experimental.modelContextProtocolServers`:
   ```json
   {
     "transport": {
       "type": "streamable-http",
       "url": "https://mcp.nodaro.ai/mcp"
     }
   }
   ```
4. Save the config → Continue prompts for OAuth in your browser
5. Sign in with your Nodaro account
6. Review the consent screen and click Allow
7. Back in your editor, the Continue chat shows Nodaro tools as available
8. Ask: "Generate an image of a knight using Nodaro."

## Troubleshooting

See [troubleshooting](./troubleshooting.md).
