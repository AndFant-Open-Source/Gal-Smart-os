<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Come contribuire

Grazie per l'interesse verso GAL OS. Le segnalazioni e i miglioramenti sono benvenuti.

## Segnalazioni

- **Problemi e proposte**: aprire una *Issue* su GitHub descrivendo cosa succede, cosa ci si
  aspettava e i passi per riprodurlo. Non inserire dati reali di un GAL.
- **Vulnerabilità di sicurezza**: **non** aprire issue pubbliche; seguire [SECURITY.md](SECURITY.md).

## Modifiche al codice

1. Fare un fork e lavorare su un ramo dedicato.
2. Rispettare le regole del progetto:
   - interfaccia e messaggi in **italiano**; mai mostrare errori tecnici all'utente
     (usare `messaggioErrore()` di `src/lib/utils.ts`);
   - TypeScript senza `any`; ogni chiamata a Supabase gestisce l'errore;
   - ogni nuovo file sorgente inizia con le intestazioni SPDX:
     ```
     // SPDX-License-Identifier: AGPL-3.0-or-later
     // SPDX-FileCopyrightText: <anno> <autore>
     // Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
     ```
   - nuove tabelle: prefisso `gal_`, campi `id`, `created_at`, `updated_at`, colonna `gal_id`
     con valore predefinito `gal_id_unico()`, e aggiunta all'elenco delle policy in
     `supabase/schema.sql` (sezione 12) e alla prova `test/schema.test.mjs`;
   - modifiche al database di installazioni esistenti: script datato in `supabase/aggiornamenti/`.
3. Verificare prima di proporre la modifica:
   ```bash
   npm run typecheck
   npm run test:db
   npm run build
   ```
4. Aprire una *Pull Request* che spieghi cosa cambia e perché.

I contributi sono rilasciati sotto la stessa licenza del progetto (AGPL-3.0-or-later con i termini
aggiuntivi di [TERMINI-AGGIUNTIVI.md](TERMINI-AGGIUNTIVI.md)); la documentazione sotto CC-BY-4.0.
