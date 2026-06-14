FROM node:22-bookworm-slim

WORKDIR /app

# ✅ FIX: yt-dlp requires python3 on Linux (Railway/Render)
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 \
  ca-certificates \
  curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

# install production deps ONLY (no postinstall scripts)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# copy built app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/audio ./audio
COPY --from=build /app/assets ./assets

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.cjs"]