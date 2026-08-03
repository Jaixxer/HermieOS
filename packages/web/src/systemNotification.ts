/**
 * Native system notification bridge.
 *
 * In the Electron desktop app we send the notification to the main
 * process (electron/main.cjs) which shows a real OS notification via
 * Electron's Notification API — the same notification center WhatsApp
 * Desktop uses. Clicking it focuses the window and navigates to the
 * linked object.
 *
 * In the browser/PWA we fall back to the HTML5 Notification API.
 */

interface SystemNotificationInput {
  title: string;
  body?: string;
  /** Route to open on click, e.g. /objects/<id> */
  url?: string;
}

interface HermieosBridge {
  notify?: (payload: { title: string; body?: string; url?: string }) => void;
  onNavigate?: (cb: (url: string) => void) => void;
}

declare global {
  interface Window {
    hermieos?: HermieosBridge;
  }
}

let permissionAsked = false;

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.hermieos?.notify;
}

/** Register a callback for "system notification clicked". */
export function onSystemNotificationNavigate(cb: (url: string) => void): () => void {
  if (isElectron() && window.hermieos?.onNavigate) {
    window.hermieos.onNavigate(cb);
  }
  // HTML5 notifications are clicked in the document, not via a global
  // handler — we register per-notification listeners instead.
  return () => undefined;
}

/**
 * Show a native system notification. Returns true if it was shown.
 */
export async function showSystemNotification(input: SystemNotificationInput): Promise<boolean> {
  const { title, body = '', url } = input;

  // Electron: route through the main process.
  if (isElectron()) {
    window.hermieos?.notify?.({ title, body, url });
    return true;
  }

  // Browser / PWA: HTML5 Notification API.
  if (typeof window !== 'undefined' && 'Notification' in window) {
    const N = window.Notification;
    if (N.permission === 'granted') {
      const n = new N(title, { body, icon: '/icon-192.png', tag: 'hermieos' });
      if (url) {
        n.onclick = () => {
          window.focus();
          window.location.href = url;
        };
      }
      return true;
    }
    if (N.permission === 'default' && !permissionAsked) {
      permissionAsked = true;
      const perm = await N.requestPermission();
      if (perm === 'granted') {
        const n = new N(title, { body, icon: '/icon-192.png', tag: 'hermieos' });
        if (url) {
          n.onclick = () => {
            window.focus();
            window.location.href = url;
          };
        }
        return true;
      }
    }
  }
  return false;
}
