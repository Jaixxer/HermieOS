/**
 * Native bridge for the Capacitor build (iOS/Android WebView).
 *
 * Everything here is a no-op on web/desktop: every entry point checks
 * `isNative()` first, so importing this module is always safe.
 *
 * Responsibilities:
 *  - StatusBar styling that matches the cream editorial theme.
 *  - Keyboard show/hide fan-out (`hermieos:keyboard` CustomEvent) so the
 *    tab bar can hide while typing and come back after.
 *  - Android back button: step the SPA history, exit only at the root.
 *  - Haptics helpers for tab presses and sheet snaps.
 */
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** matchMedia that survives jsdom/SSR/old browsers (returns false). */
export function mediaMatches(query: string): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(query).matches
    );
  } catch {
    return false;
  }
}

/** True on touch-first devices (phones/tablets). */
export function isTouchDevice(): boolean {
  return mediaMatches('(hover: none)');
}

export function keyboardEventName(): string {
  return 'hermieos:keyboard';
}

export function emitKeyboard(visible: boolean): void {
  try {
    window.dispatchEvent(new CustomEvent(keyboardEventName(), { detail: { visible } }));
  } catch {
    /* noop */
  }
}

export async function hapticTap(): Promise<void> {
  if (!isNative()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* noop */
  }
}

/** Android back button: go back in SPA history, exit the app at root. */
function wireBackButton(navigateBack: () => boolean): void {
  if (!isNative()) return;
  try {
    void App.addListener('backButton', () => {
      const handled = navigateBack();
      if (!handled) {
        void App.exitApp().catch(() => undefined);
      }
    });
  } catch {
    /* noop */
  }
}

let initialized = false;

/**
 * Call once from main.tsx. `navigateBack` should pop one SPA route and
 * return true, or return false when already at the root (app exits).
 */
export function initMobile(navigateBack: () => boolean): void {
  if (initialized || !isNative()) return;
  initialized = true;
  try {
    void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
    void StatusBar.setBackgroundColor({ color: '#f4f1e9' }).catch(() => undefined);
  } catch {
    /* noop */
  }
  try {
    Keyboard.addListener('keyboardWillShow', () => emitKeyboard(true)).catch(() => undefined);
    Keyboard.addListener('keyboardWillHide', () => emitKeyboard(false)).catch(() => undefined);
  } catch {
    /* noop */
  }
  wireBackButton(navigateBack);
}
