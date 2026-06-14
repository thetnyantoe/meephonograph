/**
 * Web server for Cupid Player PWA deployment.
 * Serves the Vite build and exposes API routes that mirror Electron IPC handlers.
 */

require('dotenv').config();
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');

const {
  getStreamUrl,
  streamUrlForVideoId,
  resolveStreamUrl,
  fetchYouTubePlaylistViaYtDlp,
  warmUp,
} = require('./yt-dlp.cjs');
const { generateAppleMusicToken } = require('./apple-music.cjs');

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const AUDIO_DIR = path.join(__dirname, '..', 'audio');

// Pending YouTube OAuth sessions: state → { clientId, scope, codeChallenge, createdAt }
const youtubeOauthSessions = new Map();
const OAUTH_SESSION_TTL = 10 * 60 * 1000;

const app = express();
app.use(express.json());

function audioDir() {
  return AUDIO_DIR;
}

function playlistFile() {
  return path.join(audioDir(), 'playlist.json');
}

function safeFilename(filename) {
  if (typeof filename !== 'string' || !filename) return null;
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
  return filename;
}

function mimeForExt(ext) {
  const mimeByExt = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
  };
  return mimeByExt[ext] || 'application/octet-stream';
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

// ── API routes ─────────────────────────────────────────────

app.post('/api/stream-url', async (req, res) => {
  try {
    const { title, artist } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    const url = await getStreamUrl(title, artist || '');
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stream-url-by-id', (req, res) => {
  try {
    const videoId = req.query.id;
    if (!videoId) return res.status(400).json({ error: 'id required' });
    const url = streamUrlForVideoId(videoId);
    res.json({ url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/audio/stream', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).send('missing id');

    const streamUrl = await resolveStreamUrl(id);
    const headers = {
      Origin: 'https://www.youtube.com',
      Referer: 'https://www.youtube.com/',
      'User-Agent': 'Mozilla/5.0',
    };
    const range = req.headers.range;
    if (range) headers.Range = range;

    const upstream = await fetch(streamUrl, { headers });
    res.status(upstream.status);
    for (const [key, value] of upstream.headers.entries()) {
      if (key.toLowerCase() === 'content-type') res.setHeader(key, 'audio/mp4');
      else res.setHeader(key, value);
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('[api/audio/stream]', err.message);
    res.status(502).send('failed');
  }
});

app.get('/api/apple-music-token', (_req, res) => {
  const token = generateAppleMusicToken();
  if (!token) return res.status(503).json({ error: 'Apple Music not configured' });
  res.json({ token });
});

app.get('/api/local/playlist', async (_req, res) => {
  try {
    const raw = await fs.promises.readFile(playlistFile(), 'utf8');
    const parsed = JSON.parse(raw);
    res.json(Array.isArray(parsed) ? parsed : []);
  } catch (err) {
    if (err.code === 'ENOENT') return res.json([]);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/local/audio/:filename', async (req, res) => {
  try {
    const filename = safeFilename(req.params.filename);
    if (!filename) return res.status(403).send('forbidden');

    const filePath = path.join(audioDir(), filename);
    const stat = await fs.promises.stat(filePath);
    const total = stat.size;
    const ext = path.extname(filename).toLowerCase();
    const contentType = mimeForExt(ext);
    const range = req.headers.range;

    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      const start = match ? parseInt(match[1], 10) : 0;
      const end = match && match[2] ? parseInt(match[2], 10) : total - 1;
      const nodeStream = fs.createReadStream(filePath, { start, end });
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Content-Type', contentType);
      nodeStream.pipe(res);
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(total));
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[api/local/audio]', err.message);
    res.status(404).send('not found');
  }
});

app.post('/api/youtube/fetch-playlist', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url required' });
    const entries = await fetchYouTubePlaylistViaYtDlp(url);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: `yt-dlp playlist fetch failed: ${err.message}` });
  }
});

// ── YouTube OAuth (web redirect flow) ──────────────────────

function cleanupOauthSessions() {
  const now = Date.now();
  for (const [state, session] of youtubeOauthSessions) {
    if (now - session.createdAt > OAUTH_SESSION_TTL) youtubeOauthSessions.delete(state);
  }
}

app.get('/api/youtube/oauth/authorize', (req, res) => {
  cleanupOauthSessions();

  const { client_id, scope, state, code_challenge } = req.query;
  if (!client_id || !scope || !state || !code_challenge) {
    return res.status(400).send('Missing OAuth parameters');
  }

  youtubeOauthSessions.set(state, {
    clientId: client_id,
    scope,
    codeChallenge: code_challenge,
    createdAt: Date.now(),
  });

  const redirectUri = `${getBaseUrl(req)}/api/youtube/oauth/callback`;
  const params = new URLSearchParams({
    client_id,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: code_challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/api/youtube/oauth/callback', (req, res) => {
  const { code, state, error } = req.query;
  const base = getBaseUrl(req);

  if (error) {
    return res.redirect(`${base}/?youtube_oauth_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state || !youtubeOauthSessions.has(state)) {
    return res.redirect(`${base}/?youtube_oauth_error=invalid_callback`);
  }

  youtubeOauthSessions.delete(state);
  const redirectUri = `${base}/api/youtube/oauth/callback`;
  const params = new URLSearchParams({
    youtube_oauth_code: code,
    youtube_oauth_state: state,
    youtube_oauth_redirect_uri: redirectUri,
  });
  res.redirect(`${base}/?${params}`);
});

// Spotify OAuth callback — SPA handles token exchange
app.get('/callback', (_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// ── Static files + SPA fallback ────────────────────────────

app.use(express.static(DIST_DIR, { index: false }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
    if (err) next(err);
  });
});

warmUp();

app.listen(PORT, () => {
  console.log(`Cupid Player web server running at http://localhost:${PORT}`);
});
