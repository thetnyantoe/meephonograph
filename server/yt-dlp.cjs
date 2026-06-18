/**
 * yt-dlp + youtubei.js helpers for the web server.
 * Mirrors the logic in electron/main.cjs for stream resolution.
 */

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");

const execFileAsync = promisify(execFile);

const streamCache = new Map();
const pendingRequests = new Map();
const videoIdCache = new Map();
const decipheredCache = new Map();
const pendingDecipher = new Map();
const CACHE_TTL = 25 * 60 * 1000;
const YTDLP_EXTRACT_TIMEOUT = 90000;
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

let videoIdCacheLoaded = false;
let videoIdCacheFile = null;
let videoIdSaveTimer = null;
let cachedYtDlpPath = null;
let innertubePromise = null;

function getCacheDir() {
  return path.join(__dirname, "..", ".cache");
}

function loadVideoIdCache() {
  if (videoIdCacheLoaded) return;
  videoIdCacheLoaded = true;
  try {
    const dir = getCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    videoIdCacheFile = path.join(dir, "video-id-cache.json");
    const raw = fs.readFileSync(videoIdCacheFile, "utf8");
    for (const [k, v] of Object.entries(JSON.parse(raw)))
      videoIdCache.set(k, v);
  } catch {
    // no cache yet
  }
}

function persistVideoIdCache() {
  if (!videoIdCacheFile) return;
  clearTimeout(videoIdSaveTimer);
  videoIdSaveTimer = setTimeout(() => {
    const obj = Object.fromEntries(videoIdCache);
    fs.promises
      .writeFile(videoIdCacheFile, JSON.stringify(obj))
      .catch(() => {});
  }, 500);
}

function getYtDlpPath() {
  if (cachedYtDlpPath) return cachedYtDlpPath;

  const binName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const candidates = [
    "/opt/homebrew/bin/yt-dlp",
    path.join(__dirname, "..", "bin", binName),
  ];

  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) {
        cachedYtDlpPath = p;
        return p;
      }
    } catch {}
  }

  cachedYtDlpPath = binName;
  return cachedYtDlpPath;
}

function ytDlpCommonArgs() {
  const nodePath = process.env.YTDLP_NODE_PATH;
  const args = [
    "--js-runtimes",
    nodePath ? `node:${nodePath}` : "node",
    "--extractor-args",
    "youtube:player_client=tv,web_safari,default",
  ];

  const browser = process.env.YTDLP_COOKIES_FROM_BROWSER;
  const cookieFile = process.env.YTDLP_COOKIES;
  if (browser) args.push("--cookies-from-browser", browser);
  else if (cookieFile) args.push("--cookies", cookieFile);

  return args;
}

async function getInnertube() {
  if (innertubePromise) return innertubePromise;
  innertubePromise = (async () => {
    const { Innertube, UniversalCache } = await import("youtubei.js");
    const cacheDir = path.join(getCacheDir(), "innertube");
    fs.mkdirSync(cacheDir, { recursive: true });
    return Innertube.create({
      cache: new UniversalCache(true, cacheDir),
      generate_session_locally: true,
    });
  })().catch((err) => {
    innertubePromise = null;
    throw err;
  });
  return innertubePromise;
}

async function searchYouTubeMusic(title, artist) {
  const yt = await getInnertube();
  const search = await yt.music.search(`${title} ${artist}`, { type: "song" });

  let top = search.songs?.contents?.find((c) => c?.id);
  if (!top) {
    for (const shelf of search.contents || []) {
      const item = shelf?.contents?.find?.((c) => c?.id);
      if (item) {
        top = item;
        break;
      }
    }
  }
  if (!top?.id) throw new Error("No song result");
  return top.id;
}

async function ytDlpExtract(target) {
  const { stdout } = await execFileAsync(
    getYtDlpPath(),
    [
      target,
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "--no-playlist",
      "--no-warnings",
      ...ytDlpCommonArgs(),
      "-g",
    ],
    { timeout: YTDLP_EXTRACT_TIMEOUT },
  );
  return stdout.trim();
}

async function ytDlpSearch(title, artist) {
  const { stdout } = await execFileAsync(
    getYtDlpPath(),
    [
      `ytsearch1:"${title}" ${artist}`,
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "--no-playlist",
      "--no-warnings",
      ...ytDlpCommonArgs(),
      "--print",
      "%(id)s",
      "-g",
    ],
    { timeout: YTDLP_EXTRACT_TIMEOUT },
  );
  const lines = stdout
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const id = lines.find((l) => YT_ID_RE.test(l));
  const url = lines.find((l) => l.startsWith("http"));
  if (!id || !url) throw new Error("yt-dlp search returned no usable result");
  return { id, url };
}

async function resolveStreamUrl(videoId) {
  const cached = decipheredCache.get(videoId);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.url;

  const inflight = pendingDecipher.get(videoId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const url = await ytDlpExtract(
        `https://www.youtube.com/watch?v=${videoId}`,
      );
      decipheredCache.set(videoId, { url, time: Date.now() });
      return url;
    } finally {
      pendingDecipher.delete(videoId);
    }
  })();

  pendingDecipher.set(videoId, promise);
  return promise;
}

function streamUrlForVideoId(videoId) {
  if (!YT_ID_RE.test(videoId)) throw new Error("Invalid YouTube video ID");
  resolveStreamUrl(videoId).catch(() => {});
  return `/api/audio/stream?id=${encodeURIComponent(videoId)}`;
}

async function getStreamUrl(title, artist) {
  const cacheKey = `${title}::${artist}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.url;

  const inflight = pendingRequests.get(cacheKey);
  if (inflight) return inflight;

  loadVideoIdCache();
  let videoId = videoIdCache.get(cacheKey);

  const promise = (async () => {
    try {
      if (!videoId) {
        try {
          videoId = await searchYouTubeMusic(title, artist);
        } catch (err) {
          console.warn("[youtubei search] fallback to yt-dlp:", err.message);
          const result = await ytDlpSearch(title, artist);
          videoId = result.id;
          decipheredCache.set(videoId, { url: result.url, time: Date.now() });
        }
        videoIdCache.set(cacheKey, videoId);
        persistVideoIdCache();
      }

      resolveStreamUrl(videoId).catch(() => {});
      const url = `/api/audio/stream?id=${encodeURIComponent(videoId)}`;
      streamCache.set(cacheKey, { url, time: Date.now() });
      return url;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, promise);
  return promise;
}

async function fetchYouTubePlaylistViaYtDlp(url) {
  const { stdout } = await execFileAsync(
    getYtDlpPath(),
    [
      url,
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      ...ytDlpCommonArgs(),
    ],
    { timeout: 60000, maxBuffer: 50 * 1024 * 1024 },
  );

  const data = JSON.parse(stdout);
  const entries = data.entries || [];
  return entries
    .filter((e) => e && e.id && YT_ID_RE.test(e.id))
    .map((e) => ({
      videoId: e.id,
      title: e.title || e.id,
      artist: e.uploader || e.channel || "",
      duration: typeof e.duration === "number" ? e.duration : null,
    }));
}

function warmUp() {
  getInnertube().catch(() => {});
  execFile(getYtDlpPath(), ["--version"], () => {});
}

module.exports = {
  getStreamUrl,
  streamUrlForVideoId,
  resolveStreamUrl,
  fetchYouTubePlaylistViaYtDlp,
  warmUp,
  getYtDlpPath,
};
