FROM node:22-bookworm-slim AS build

WORKDIR /app

# yt-dlp for Linux amd64 (override platform in build if needed)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_* env vars must be passed at build time if you use Spotify/YouTube/Apple in the bundle
ARG VITE_SPOTIFY_CLIENT_ID
ARG VITE_SPOTIFY_REDIRECT_URI
ARG VITE_YOUTUBE_CLIENT_ID
ARG VITE_YOUTUBE_CLIENT_SECRET
ENV VITE_SPOTIFY_CLIENT_ID=$VITE_SPOTIFY_CLIENT_ID
ENV VITE_SPOTIFY_REDIRECT_URI=$VITE_SPOTIFY_REDIRECT_URI
ENV VITE_YOUTUBE_CLIENT_ID=$VITE_YOUTUBE_CLIENT_ID
ENV VITE_YOUTUBE_CLIENT_SECRET=$VITE_YOUTUBE_CLIENT_SECRET

RUN npm run build:web

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/audio ./audio
COPY --from=build /app/assets ./assets

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/index.cjs"]
