import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://splotlabs.io",
  output: "static",
  devToolbar: { enabled: false },
  // External CSS and JS files only, so that the Content-Security-Policy needs no 'unsafe-inline'.
  build: { inlineStylesheets: "never" },
  vite: { build: { assetsInlineLimit: 0 } },
});
