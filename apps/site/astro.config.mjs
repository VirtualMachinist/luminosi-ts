import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Static by default: pages ship HTML and CSS; JavaScript only for islands.
export default defineConfig({
  output: "static",
  vite: { plugins: [tailwindcss()] },
  // Astro hashes its inline island scripts and styles into a <meta> CSP on every page, so no
  // 'unsafe-inline' is needed. wasm-unsafe-eval: the meshopt decoder compiles WebAssembly.
  // frame-ancestors cannot live in a <meta> policy; the server sends it as a header.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "worker-src 'self' blob:",
        "connect-src 'self' data: blob:",
        "object-src 'none'",
        "base-uri 'self'",
      ],
      scriptDirective: { resources: ["'self'", "'wasm-unsafe-eval'"] },
      styleDirective: { resources: ["'self'"] },
    },
  },
});
