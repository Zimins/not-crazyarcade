import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
  server: {
    fs: {
      // wasm-pack 출력(src/wasm/pkg)을 dev 서버가 읽을 수 있도록
      allow: ["."],
    },
  },
});
