/**
 * PWA utilities: install prompt + push subscription.
 *
 * The `beforeinstallprompt` event is captured on mount and an install
 * button is shown when the app is eligible but not yet installed.
 *
 * Push subscription uses the Web Push API. The service worker must
 * already be registered (done in index.html). The server's VAPID
 * public key is fetched from GET /me/push-vapid-key.
 */
import * as React from 'react';
import { api } from './api';

interface PwaState {
  installReady: boolean;
  pushSupported: boolean;
  pushSubscribed: boolean;
  install: () => void;
  subscribeToPush: () => Promise<void>;
  unsubscribeFromPush: () => Promise<void>;
}

export function usePwa(): PwaState {
  const [installReady, setInstallReady] = React.useState(false);
  const [pushSupported, setPushSupported] = React.useState(false);
  const [pushSubscribed, setPushSubscribed] = React.useState(false);
  const deferredPrompt = React.useRef<{ prompt: () => Promise<void> } | null>(null);

  // --- Install prompt ---
  React.useEffect(() => {
    function onBeforeInstall(e: Event): void {
      e.preventDefault();
      deferredPrompt.current = e as unknown as { prompt: () => Promise<void> };
      setInstallReady(true);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  // --- Push subscription ---
  React.useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const sw = navigator.serviceWorker;
    // Wait for the service worker to be ready (it may register after
    // mount). Don't bail on `!sw.controller` — that only means the page
    // hasn't been claimed yet.
    sw.ready
      .then(async (reg) => {
        setPushSupported(true);
        const sub = await reg.pushManager.getSubscription();
        setPushSubscribed(!!sub);
      })
      .catch(() => { /* push not supported */ });
  }, []);

  return {
    installReady,
    pushSupported,
    pushSubscribed,
    install(): void {
      if (deferredPrompt.current) {
        deferredPrompt.current.prompt().catch(() => {});
        deferredPrompt.current = null;
        setInstallReady(false);
      }
    },
    async subscribeToPush(): Promise<void> {
      const sw = navigator.serviceWorker;
      const reg = await sw.ready;
      const vapid = await api.pushVapidKey();
      if (!vapid.publicKey) return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8(vapid.publicKey),
      });
      const json = sub.toJSON();
      await api.savePushSubscription({
        endpoint: json.endpoint!,
        keys: { auth: json.keys!.auth!, p256dh: json.keys!.p256dh! },
        userAgent: navigator.userAgent,
      });
      setPushSubscribed(true);
    },
    async unsubscribeFromPush(): Promise<void> {
      const sw = navigator.serviceWorker;
      const reg = await sw.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.removePushSubscription({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setPushSubscribed(false);
    },
  };
}

/** Convert a base64url VAPID key to a Uint8Array for pushManager.subscribe. */
function urlB64ToUint8(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output as Uint8Array<ArrayBuffer>;
}

/** Small inline component for the install + push buttons. */
export function PwaBanner(): React.JSX.Element | null {
  const { installReady, pushSupported, pushSubscribed, install, subscribeToPush, unsubscribeFromPush } = usePwa();

  if (!installReady && !pushSupported) return null;

  return (
    <div className="border-b border-slate-800 bg-slate-900/60 px-4 py-2 flex items-center justify-center gap-4 text-sm">
      {installReady ? (
        <button className="btn-primary" onClick={install}>
          Install app
        </button>
      ) : null}
      {pushSupported ? (
        pushSubscribed ? (
          <button className="btn-ghost text-xs" onClick={() => { unsubscribeFromPush().catch(() => {}); }}>
            Notifications on — tap to mute
          </button>
        ) : (
          <button className="btn-secondary" onClick={() => { subscribeToPush().catch(() => {}); }}>
            Enable notifications
          </button>
        )
      ) : null}
    </div>
  );
}
