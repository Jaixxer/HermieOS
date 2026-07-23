/**
 * Detect whether the app is running inside Tauri.
 * Returns false during SSR and web development.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
