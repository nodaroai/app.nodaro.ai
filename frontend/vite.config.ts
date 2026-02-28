import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@remotion-pkg": path.resolve(__dirname, "../packages/remotion/src"),
      "@nodaro-shared": path.resolve(__dirname, "../packages/shared/src"),
    },
    dedupe: ["remotion", "react", "react-dom"],
  },
  server: {
    port: 3000,
    proxy: {
      "/v1": {
        target: process.env.VITE_API_URL || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3000,
    proxy: {
      "/v1": {
        target: process.env.VITE_API_URL || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules/")) return undefined;

          // Scoped packages
          if (id.includes("node_modules/@xyflow/")) return "xyflow";
          if (id.includes("node_modules/@radix-ui/")) return "radix-ui";
          if (id.includes("node_modules/@supabase/")) return "supabase";
          if (id.includes("node_modules/@tanstack/")) return "query-vendor";
          if (id.includes("node_modules/@dnd-kit/")) return "dnd-kit";

          // Markdown + unified ecosystem
          if (
            id.includes("node_modules/react-markdown/") ||
            id.includes("node_modules/remark-") ||
            id.includes("node_modules/micromark") ||
            id.includes("node_modules/mdast-") ||
            id.includes("node_modules/unified/") ||
            id.includes("node_modules/unist-") ||
            id.includes("node_modules/devlop/")
          )
            return "markdown";

          // Remotion (lazy-loaded for Player preview)
          if (
            id.includes("node_modules/remotion/") ||
            id.includes("node_modules/@remotion/")
          )
            return "remotion";

          // Zod standalone
          if (id.includes("node_modules/zod/")) return "zod";

          // React core (after react-markdown etc.)
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/") ||
            id.includes("node_modules/react-router/") ||
            id.includes("node_modules/scheduler/")
          )
            return "react-vendor";

          // UI utility libs grouped
          if (
            id.includes("node_modules/lucide-react/") ||
            id.includes("node_modules/sonner/") ||
            id.includes("node_modules/class-variance-authority/") ||
            id.includes("node_modules/clsx/") ||
            id.includes("node_modules/tailwind-merge/") ||
            id.includes("node_modules/next-themes/") ||
            id.includes("node_modules/zustand/")
          )
            return "ui-vendor";
        },
      },
    },
  },
})
