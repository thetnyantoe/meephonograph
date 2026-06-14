# Deploy Cupid Player as a PWA (for iPhone / Android)

Your girlfriend can open a URL in Safari, tap **Share → Add to Home Screen**, and use Cupid Player like an app — no App Store needed.

The web version runs the same UI as the Electron app. Streaming (Spotify, Apple Music, YouTube) goes through a small Node server because yt-dlp and Apple Music tokens can't run in the browser alone.

## Quick start (local test)

```bash
cd cupid-music-player
npm install
npm run build:web
npm start
```

Open **http://localhost:3000** on your phone (same Wi‑Fi) or use your machine's LAN IP.

For dev with hot reload:

```bash
npm run dev:web
```

Opens Vite on **http://127.0.0.1:5173** (API proxied to port 3000).

## Deploy to the internet

You need a host that runs **Node.js** and can execute **yt-dlp** (not static-only hosts like GitHub Pages).

### Option A — Railway / Render / Fly.io (recommended)

1. Push this repo to GitHub.
2. Create a new **Web Service** and connect the repo.
3. Set the root directory to `cupid-music-player` if needed.
4. **Build command:** `npm install && npm run build:web`
5. **Start command:** `npm start`
6. Add environment variables from `.env` (see below).
7. Copy your public URL (e.g. `https://cupid-player.up.railway.app`).

### Option B — Docker (VPS, Fly, etc.)

```bash
docker build -t cupid-player .
docker run -p 3000:3000 --env-file .env cupid-player
```

### Option C — Your own VPS

```bash
npm install
npm run build:web
PUBLIC_URL=https://your-domain.com npm start
```

Use nginx/Caddy as HTTPS reverse proxy in front of port 3000.

## Environment variables

Copy `.env.example` to `.env` and fill in what you use:

| Variable | Required | Notes |
|----------|----------|-------|
| `PORT` | No | Default `3000` |
| `PUBLIC_URL` | Yes (production) | Full public URL, e.g. `https://cupid.example.com` — used for OAuth redirects |
| `VITE_SPOTIFY_CLIENT_ID` | For Spotify | From Spotify Developer Dashboard |
| `VITE_SPOTIFY_REDIRECT_URI` | Optional | Defaults to `{PUBLIC_URL}/callback` |
| `VITE_YOUTUBE_CLIENT_ID` | For YouTube sign-in | Google Cloud OAuth |
| `VITE_YOUTUBE_CLIENT_SECRET` | For YouTube sign-in | Paired with client ID |
| `APPLE_TEAM_ID` | For Apple Music | Apple Developer |
| `APPLE_KEY_ID` | For Apple Music | Apple Developer |
| `.p8` key file | For Apple Music | Place in project root |

**Important:** `VITE_*` variables are baked in at **build time**. Set them in your host's build environment, then rebuild when they change.

## OAuth setup for deployed URL

### Spotify

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → your app → **Settings**.
2. Add **Redirect URI:** `https://your-domain.com/callback`
3. Rebuild and redeploy after setting `VITE_SPOTIFY_CLIENT_ID`.

### YouTube (Google)

For the **web/PWA** build you need a **Web application** OAuth client (not Desktop):

1. Google Cloud Console → **Credentials** → **Create OAuth client ID** → **Web application**.
2. **Authorized redirect URIs:** `https://your-domain.com/api/youtube/oauth/callback`
3. Add the same Google account under **OAuth consent screen → Test users** if the app is in Testing.
4. Set `VITE_YOUTUBE_CLIENT_ID` and `VITE_YOUTUBE_CLIENT_SECRET`, then rebuild.

The **Desktop app** client still works for the Electron build; the web build uses the Web client redirect above.

### Apple Music

Works the same as Electron — server generates the developer JWT from your `.p8` key. MusicKit login runs in the browser.

## Install on iPhone (Safari)

1. Open your deployed URL in **Safari** (Chrome on iOS won't install PWAs properly).
2. Tap the **Share** button (square with arrow).
3. Tap **Add to Home Screen**.
4. Name it (e.g. "Cupid") and tap **Add**.

The app opens full-screen without Safari's address bar.

## Local music on the server

The `audio/` folder on the server holds `playlist.json` and MP3 files — same as the desktop app. Upload your songs to the deployed instance (or bake them into the Docker image) so she hears your curated playlist.

On Railway/Render, attach persistent storage or include MP3s in the repo if they're not huge.

## What works on web vs desktop

| Feature | Desktop (Electron) | Web/PWA |
|---------|-------------------|---------|
| Pixel-art player UI | ✓ | ✓ |
| Spotify playlists | ✓ | ✓ |
| Apple Music | ✓ | ✓ |
| YouTube URL paste | ✓ | ✓ |
| YouTube sign-in | ✓ (Desktop OAuth) | ✓ (Web OAuth) |
| Local MP3s | ✓ (local folder) | ✓ (server `audio/`) |
| Frameless window / resize | ✓ | — |
| Add to Home Screen | — | ✓ |

## Troubleshooting

**Songs won't play / 502 on stream** — yt-dlp missing or outdated on the server. Run `node scripts/install-yt-dlp.cjs` during build (postinstall does this automatically).

**Spotify login fails** — Redirect URI in Spotify dashboard must exactly match `https://your-domain.com/callback`.

**YouTube login fails** — Use a **Web application** OAuth client and add the `/api/youtube/oauth/callback` redirect URI.

**PWA won't install** — Must be served over HTTPS. Safari only; use Share → Add to Home Screen.
