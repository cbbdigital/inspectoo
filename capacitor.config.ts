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
    url: 'https://inspectooo.netlify.app',
    cleartext: false
  },
  ios: {
    contentInset: 'always'
  }
};

export default config;
