/**
 * True when running inside the Electron desktop app (preload exposes window.cupid).
 */
export function isElectron() {
  return typeof window.cupid?.version === 'string'
    && window.cupid.version !== 'web';
}
