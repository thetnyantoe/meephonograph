/**
 * Browser/PWA implementation of window.cupid — calls the web server API
 * instead of Electron IPC.
 */

async function apiJson(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || text;
    } catch {
      // keep raw text
    }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json();
}

function updateFavicon(theme) {
  const link = document.querySelector('link[rel="icon"]');
  if (link) link.href = theme === 'blue' ? '/pwa-icon-blue.png' : '/pwa-icon.png';
}

export function initWebCupid() {
  if (window.cupid?.version === 'web') return;

  window.cupid = {
    version: 'web',

    minimize: () => {},
    maximize: () => {},
    close: () => {},
    resize: () => {},
    openExternal: (url) => window.open(url, '_blank', 'noopener'),
    setTheme: (theme) => updateFavicon(theme),

    getStreamUrl: async (title, artist) => {
      const { url } = await apiJson('/api/stream-url', {
        method: 'POST',
        body: JSON.stringify({ title, artist }),
      });
      return url;
    },

    getStreamUrlById: async (videoId) => {
      const { url } = await apiJson(`/api/stream-url-by-id?id=${encodeURIComponent(videoId)}`);
      return url;
    },

    getAppleMusicToken: async () => {
      const { token } = await apiJson('/api/apple-music-token');
      return token;
    },

    getLocalPlaylist: async () => {
      return apiJson('/api/local/playlist');
    },

    getLocalAudioPath: async (filename) => {
      return `/api/local/audio/${encodeURIComponent(filename)}`;
    },

    openMusicFolder: async () => null,

    youtubeFetchPlaylist: async (url) => {
      return apiJson('/api/youtube/fetch-playlist', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
    },

  };
}
