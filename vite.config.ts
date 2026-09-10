import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { staticRouteHtml } from "./scripts/static-route-html.ts";

export default defineConfig({
  plugins: [react(), staticRouteHtml(), {
    name: "admin-index",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/admin" || req.url === "/admin/") req.url = "/admin/index.html";
        next();
      });
    },
  }],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "router-vendor", test: /node_modules\/(react-router|react-router-dom)\// },
            { name: "react-vendor", test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: "animation-vendor", test: /node_modules\/(gsap|@gsap|motion|motion-dom|motion-utils|framer-motion)\// },
            { name: "three-core", test: /node_modules\/three\/build\/three.core/ },
            { name: "three-renderer", test: /node_modules\/three\/build\/three.module/ },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: false,
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
