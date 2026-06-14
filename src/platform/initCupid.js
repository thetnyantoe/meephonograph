import { initWebCupid } from './webCupid.js';

/**
 * Initialise window.cupid for web/PWA when Electron preload is not present.
 */
export function initCupid() {
  if (window.cupid?.version && window.cupid.version !== 'web') return;
  initWebCupid();
}
