# Inspecto → aplicație iOS (Capacitor, Varianta A: încarcă Netlify live)

Aplicația nativă e o carcasă care încarcă `https://inspectooo.netlify.app`.
**Actualizezi codul ca până acum:** urci în GitHub → Netlify redeploy → aplicația se
actualizează singură la următoarea deschidere. Xcode e necesar DOAR pentru schimbări
native (icon, nume, permisiuni, plugin-uri, versiune Capacitor).

## O singură dată — instalare

În folderul proiectului (unde e `package.json` și `capacitor.config.ts`):

```bash
# CocoaPods (dacă nu există)
pod --version || sudo gem install cocoapods

# Dependințe Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/ios

# Build web (creează dist/ — necesar chiar dacă încărcăm de pe Netlify)
npm run build

# Adaugă platforma iOS și sincronizează config-ul
npx cap add ios
npx cap sync

# Deschide în Xcode
npx cap open ios
```

> NU rula `npx cap init` — `capacitor.config.ts` e deja pregătit.

## În Xcode (o singură dată)

1. Selectează proiectul **App** (stânga) → tab **Signing & Capabilities**
   - La **Team** alege contul tău Apple (Add Account cu Apple ID).
   - **Bundle Identifier**: `ro.inspectoo.app` (sau schimbă-l, trebuie unic).
2. Adaugă permisiunile în **Info.plist** (App → Info), altfel camera/microfonul nu merg:
   - `Privacy - Camera Usage Description` → „Fotografiere documente și inspecții"
   - `Privacy - Microphone Usage Description` → „Dictare vocală programări"
   - `Privacy - Photo Library Additions Usage Description` → „Salvare poze inspecții"
3. Alege un simulator (ex. iPhone 15) sau conectează iPhone-ul tău → apasă **▶ Run**.

Pe iPhone fizic: Settings → Privacy & Security → **Developer Mode** ON, și „trust" la computer.

## Actualizări după lansare

- **Erori / schimbări de cod (99% din cazuri):** urci în GitHub → Netlify redeploy.
  Aplicația ia automat noua versiune. **Fără Xcode, fără App Store.**
- **Schimbări native** (icon, nume, permisiuni noi, plugin nou, update Capacitor):
  `npx cap sync` → rebuild în Xcode → (dacă e în App Store) Archive → Distribute.

## Publicare în App Store (opțional, cont Apple Developer 99$/an)

Xcode → Product → **Archive** → Distribute App → App Store Connect.

## De verificat pe telefon (au nevoie de ajustări native)

- **Dictarea vocală** (Web Speech API) — poate să nu meargă în WKWebView; dacă nu merge,
  îți pun un plugin nativ de speech.
- **Descărcarea pozelor în folder** (`showDirectoryPicker`) — nu există pe iOS; se
  înlocuiește cu salvare în Files / Share (plugin Capacitor Filesystem/Share).
- **Notificări push** — prin plugin Capacitor Push (APNs), separat de Web Push.
