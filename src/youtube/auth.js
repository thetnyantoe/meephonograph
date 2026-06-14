/**
 * Google OAuth 2.0 PKCE flow for the YouTube Data API.
 *
 * Electron: loopback HTTP server in the main process captures the redirect.
 * Web/PWA: server redirect flow via /api/youtube/oauth/authorize.
 */

const CLIENT_ID = import.meta.env.VITE_YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_YOUTUBE_CLIENT_SECRET;
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

const TOKEN_KEY = 'youtube_token';
const REFRESH_KEY = 'youtube_refresh_token';
const EXPIRY_KEY = 'youtube_token_expiry';
const VERIFIER_KEY = 'youtube_code_verifier';

// ── PKCE helpers ─────────────────────────────────────────────

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  const str = String.fromCharCode(...bytes);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

async function makeCodeChallenge(verifier) {
  return base64UrlEncode(await sha256(verifier));
}

function isWebBuild() {
  return window.cupid?.version === 'web';
}

// ── Public API ───────────────────────────────────────────────

export function isConfigured() {
  return !!CLIENT_ID;
}

export function isLoggedIn() {
  return !!localStorage.getItem(TOKEN_KEY);
}

/**
 * Begin OAuth. Electron opens system browser with loopback callback.
 * Web redirects through the server OAuth endpoints.
 */
export async function login() {
  if (!CLIENT_ID) {
    throw new Error('Missing VITE_YOUTUBE_CLIENT_ID — see YOUTUBE_SETUP.md');
  }

  const verifier = randomString(64);
  const challenge = await makeCodeChallenge(verifier);
  const state = randomString(32);
  localStorage.setItem(VERIFIER_KEY, verifier);

  if (isWebBuild()) {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
      state,
      code_challenge: challenge,
    });
    window.location.href = `/api/youtube/oauth/authorize?${params}`;
    return null;
  }

  if (!window.cupid?.youtubeOauthStart) {
    throw new Error('YouTube sign-in is unavailable in this build');
  }

  const { code, redirectUri } = await window.cupid.youtubeOauthStart({
    clientId: CLIENT_ID,
    scope: SCOPE,
    state,
    codeChallenge: challenge,
  });

  await exchangeCode(code, redirectUri, verifier);
  return localStorage.getItem(TOKEN_KEY);
}

async function exchangeCode(code, redirectUri, verifier) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: verifier,
  });
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  storeTokens(data);
  localStorage.removeItem(VERIFIER_KEY);
}

/**
 * Handle OAuth callback on web after server redirect.
 * Call from App on mount when URL contains youtube_oauth_code.
 */
export async function handleWebCallback() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('youtube_oauth_error');
  if (error) throw new Error(`YouTube auth error: ${error}`);

  const code = params.get('youtube_oauth_code');
  if (!code) return null;

  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('Missing PKCE verifier — please try logging in again');

  const redirectUri = params.get('youtube_oauth_redirect_uri');
  if (!redirectUri) throw new Error('Missing redirect URI in callback');

  await exchangeCode(code, redirectUri, verifier);
  window.history.replaceState({}, '', window.location.pathname);
  return localStorage.getItem(TOKEN_KEY);
}

function storeTokens({ access_token, refresh_token, expires_in }) {
  if (access_token) localStorage.setItem(TOKEN_KEY, access_token);
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
  if (expires_in) localStorage.setItem(EXPIRY_KEY, String(Date.now() + expires_in * 1000));
}

export async function getAccessToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = Number(localStorage.getItem(EXPIRY_KEY) || '0');
  if (token && Date.now() < expiry - 60_000) return token;

  const refreshed = await refreshAccessToken();
  if (refreshed) return refreshed;

  return token || null;
}

async function refreshAccessToken() {
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return null;

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    refresh_token: refresh,
    grant_type: 'refresh_token',
  });
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    logout();
    return null;
  }
  const data = await res.json();
  storeTokens(data);
  return data.access_token;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  localStorage.removeItem(VERIFIER_KEY);
}

export function cancelLogin() {
  window.cupid?.youtubeOauthCancel?.();
}
