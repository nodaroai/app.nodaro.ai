import { Config } from "@remotion/cli/config"
import path from "path"

Config.setEntryPoint("./src/Root.tsx")

// @react-three/fiber bundles its own scheduler@0.21 which conflicts with
// React 18.3's scheduler@0.23. The version mismatch causes
// "Cannot read properties of undefined (reading 'ReactCurrentBatchConfig')".
// Force all packages to use the single root copies.
Config.overrideWebpackConfig((config) => {
  const nodeModules = path.resolve(process.cwd(), "node_modules")
  config.resolve = config.resolve ?? {}
  config.resolve.alias = {
    ...config.resolve.alias,
    react: path.resolve(nodeModules, "react"),
    "react-dom": path.resolve(nodeModules, "react-dom"),
    scheduler: path.resolve(nodeModules, "scheduler"),
  }
  return config
})
