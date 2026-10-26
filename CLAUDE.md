<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# CLAUDE.md — GAL OS, edizione per singolo GAL

Istruzioni per chi sviluppa (anche con un assistente AI) su questo repository.

## Principio
**Un GAL = un progetto Supabase = un sito Cloudflare.** Non reintrodurre mai gestioni multi-GAL,
cambi di GAL o amministratori globali. La tabella `gal_gal` ha una sola riga (vincolo nel database).

## Stack
React 18 + TypeScript + Vite, Tailwind CSS, Supabase JS (PKCE), Zustand, jsPDF, SheetJS, JSZip,
Recharts, date-fns, sonner, lucide-react. Deploy: Cloudflare Pages da fork GitHub del GAL.

## Regole
- Interfaccia e messaggi in italiano; errori mostrati solo tramite `messaggioErrore()`.
- Niente `any`; ogni chiamata Supabase gestisce l'errore.
- **Sicurezza nel database**, non solo nell'interfaccia: policy RLS con `gal_utente_attivo()`,
  `gal_is_operatore()`, `gal_is_admin()`. Nuove tabelle vanno aggiunte agli elenchi `principali`
  o `dettagli` della sezione 12 di `supabase/schema.sql` e alla prova `test/schema.test.mjs`.
- Nel browser solo la chiave `anon`; mai `service_role`.
- Nessuna risorsa esterna (caratteri, script, CDN): la CSP in `public/_headers` le blocca.
- Intestazioni SPDX in ogni file sorgente; non modificare `LICENSE` né l'avviso di attribuzione
  in `src/components/InfoSoftware.tsx` (Termine 1 di TERMINI-AGGIUNTIVI.md).
- `.env`, backup ZIP ed esportazioni Excel non vanno mai committati.

## Comandi
```bash
npm run dev        # sviluppo (http://localhost:5173)
npm run typecheck  # controllo tipi
npm run test:db    # schema + regole di sicurezza su PostgreSQL in memoria
npm run build      # compilazione in dist/
```
