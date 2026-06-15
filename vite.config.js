import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const isElectronBuild = process.env.VITE_BUILD_TARGET === "electron";

export default defineConfig({
  plugins: [
    react(),
    !isElectronBuild &&
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["pwa-icon.png", "pwa-icon-blue.png"],
        manifest: {
          name: "Mees",
          short_name: "Mees",
          description: "19+25=19",
          theme_color: "#78364F",
          background_color: "#1a1a1a",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "pwa-icon.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "pwa-icon.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "pwa-icon.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          mode: "development",
          globPatterns: ["**/*.{js,css,html,ico,png,ttf,woff,woff2}"],
          navigateFallback: "index.html",
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/i\.ytimg\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "album-art",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 7 * 24 * 60 * 60,
                },
              },
            },
            {
              urlPattern: /^https:\/\/is\d+-ssl\.mzstatic\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "album-art-apple",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 7 * 24 * 60 * 60,
                },
              },
            },
          ],
        },
      }),
  ].filter(Boolean),
  base: isElectronBuild ? "./" : "/",
  publicDir: "public",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
