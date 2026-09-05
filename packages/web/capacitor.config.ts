import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hermieos.app',
  appName: 'HermieOS',
  // Vite builds with base './', so the bundled app runs from any origin
  // (capacitor://, https://localhost, file://) without rewrites.
  webDir: 'dist',
  backgroundColor: '#f4f1e9',
  android: {
    // Allow http:// LAN backends (e.g. http://192.168.1.50:3001) while the
    // server lives on the local network. Production servers use https.
    cleartext: true,
  },
  ios: {
    // Same story for iOS: the bundled WKWebView talks to a LAN server.
    // Served over https in production; keep scheme default.
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    StatusBar: {
      style: 'light',
      backgroundColor: '#f4f1e9',
      overlaysWebView: false,
    },
    Keyboard: {
      // Shrink the WebView instead of overlaying it — inputs stay visible.
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
  server: {
    // Dev live-reload against the LAN host running `pnpm dev`:
    //   npx cap run android --livereload --external
    // The URL + port are injected by the CLI at run time.
    cleartext: true,
    // The local API is HTTP. Using an HTTP app origin avoids WebView mixed
    // content blocking during LAN development; production uses HTTPS.
    androidScheme: 'http',
  },
};

export default config;
