import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Varianta A: aplicația nativă încarcă site-ul live de pe Netlify.
 * Actualizările se fac prin redeploy pe Netlify — fără rebuild Xcode,
 * fără retrimitere în App Store (doar pentru schimbări native).
 */
const config: CapacitorConfig = {
  appId: 'ro.inspectoo.app',
  appName: 'Inspecto',
  webDir: 'dist',
  server: {
    // aplicația e la /dashboard (landing-ul public e la /)
    url: 'https://inspectooo.netlify.app/dashboard',
    cleartext: false
  },
  ios: {
    // 'never' = WKWebView ocupă tot ecranul (edge-to-edge); safe-area o gestionează
    // CSS prin env(safe-area-inset-*). Cu 'always' se dublau marginile sus/jos.
    contentInset: 'never'
  }
};

export default config;
