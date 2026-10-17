# Inspecto v2.0 — aplicație nouă (mobile)

Interfață nouă pentru stația ITP, **separată complet** de aplicația veche.
Se conectează la **aceeași** bază Supabase existentă, **fără** a modifica schema
și **fără** a atinge aplicația veche.

## Faza 1 — DOAR CITIRE (siguranță maximă)
- Aplicația doar **citește** date reale (programări, clienți, poze) prin RLS.
- **Nu scrie nimic** în bază. Modificările făcute în UI rămân locale (nu se salvează).
- Verifici că totul apare corect, apoi trecem la Faza 2 (activăm scrierile).

## Configurare (o singură dată)

### 1. GitHub
```bash
git init
git add .
git commit -m "Inspecto v2.0 — aplicație nouă (read-only)"
git branch -M main
git remote add origin https://github.com/<user>/inspecto-app.git
git push -u origin main
```

### 2. Netlify
- New site → Import from GitHub → alege repo-ul `inspecto-app`.
- Build command: `npm run build`  ·  Publish directory: `dist` (deja în `netlify.toml`).
- Site settings → Environment variables, adaugă:
  - `VITE_SUPABASE_URL` = `https://<proiect>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = cheia **anon / public** (Supabase → Settings → API)
  - ⚠️ Niciodată cheia `service_role` în frontend.
- Deploy.

### 3. Local (opțional)
```bash
cp .env.example .env   # completează cele 2 variabile
npm install
npm run dev
```

## Ce NU se atinge
- Schema bazei: zero migrații, zero `ALTER` — doar `SELECT` pe tabelele existente.
- Aplicația veche: repo și deploy separate, neatinse.

## Trecerea la Faza 2 (scriere)
Se face schimbând `READONLY = false` în `src/boot.js` și legând handlerele de
scriere din `src/sync.js` (`saveAppointment`, `addManualClient`, etc.).
Scrierile trec prin aceleași reguli RLS ca aplicația veche.

## OCR (funcția „Text")
Citirea automată a textului din poze necesită un serviciu extern (ex. Google
Vision, printr-o edge function). Până atunci: codul de bare CIV se citește local,
iar câmpurile CIV/VIN/buletin se pot completa manual.
