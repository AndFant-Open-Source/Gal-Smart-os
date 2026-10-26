<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Database — edizione per singolo GAL

Ogni GAL ha il **proprio progetto Supabase**. Il database contiene i dati di un solo ente: la tabella
`gal_gal` accetta una sola riga, quindi nessun utente, nemmeno l'amministratore, può vedere o
gestire un altro GAL.

## Installazione

1. Creare un progetto Supabase nuovo (regione consigliata: Central EU — Frankfurt).
2. Aprire la **SQL Editor** ed eseguire l'intero file [`schema.sql`](schema.sql).
   Crea anche l'archivio file privato `documenti_gal`. Rieseguirlo non cancella dati.
3. Disattivare la registrazione libera e nominare l'amministratore: vedi
   [docs/installazione.md](../docs/installazione.md).

Prova automatica (senza Supabase, su PostgreSQL in memoria): `npm run test:db`.

## Tabelle

Tutte con prefisso `gal_`, chiave `id uuid`, `created_at`, `updated_at` (aggiornato da trigger) e
Row Level Security attiva.

| Area | Tabelle |
|------|---------|
| Ente e persone | `gal_gal` (una riga), `gal_profili`, `gal_audit` (registro attività) |
| Bandi | `gal_bandi`, `gal_domande_sostegno`, `gal_pagamenti_bando` |
| Organi sociali | `gal_soci`, `gal_quote_sociali`, `gal_organi`, `gal_componenti`, `gal_sedute`, `gal_delibere` |
| Rendicontazione | `gal_fornitori`, `gal_periodi_ses`, `gal_interventi`, `gal_tipologie_spesa`, `gal_capitoli`, `gal_voci_previsione`, `gal_giustificativi`, `gal_pagamenti_giust`, `gal_righe_imputazione`, `gal_documenti_giustificativo` |
| Acquisti | `gal_procedure`, `gal_procedure_invitati`, `gal_contratti` |
| Archivio | `gal_fascicoli` (registro di catalogazione) |
| Agenda | `gal_agenda_pratiche`, `gal_agenda_checklist`, `gal_agenda_note` |
| Pagamenti e cassa | `gal_conti`, `gal_scadenze_pagamento`, `gal_movimenti_cassa` |

## Permessi

| Operazione | Lettore | Operatore | Admin |
|------------|:---:|:---:|:---:|
| Consultare tutti i dati e gli allegati | ✅ | ✅ | ✅ |
| Inserire e modificare, caricare allegati | ❌ | ✅ | ✅ |
| Eliminare passaggi di check list, note, righe di dettaglio, allegati | ❌ | ✅ | ✅ |
| Eliminare registri principali (bandi, giustificativi, scadenze, pratiche…) | ❌ | ❌ | ✅ |
| Modificare i dati del GAL, gestire utenti, importare backup | ❌ | ❌ | ✅ |

Un account **senza profilo attivo** (registrato da solo, o invitato e non ancora attivato) non vede
nulla. Il ruolo anonimo non ha accesso alle tabelle.

## Funzioni

| Funzione | Uso |
|----------|-----|
| `gal_utente_attivo()`, `gal_is_operatore()`, `gal_is_admin()` | Controlli usati dalle policy |
| `gal_id_unico()` | Valore predefinito della colonna `gal_id` |
| `gal_nomina_amministratore(email)` | Da eseguire **solo** nella SQL Editor per il primo amministratore |
| `gal_importa_registro_attivita(righe)` | Importazione dello storico da un backup (solo admin) |

## Regole applicate dal database

- Nuovi account con profilo disattivato; ruolo, stato e funzione li cambia solo l'amministratore.
- Sempre almeno un amministratore attivo.
- Registro attività: ogni evento a nome di chi lo crea, non modificabile né eliminabile.
- Scadenzario: CUP obbligatorio; CIG obbligatorio salvo esclusione motivata; numero di mandato unico.
- Registro di catalogazione: numero di fascicolo unico.
- Archivio file privato, 50 MB per file; lettura agli utenti attivi, scrittura agli operatori.

## Aggiornamenti dei database già installati

Le nuove installazioni usano solo `schema.sql`. Gli aggiornamenti futuri saranno nella cartella
`aggiornamenti/` con la data nel nome, da eseguire una volta nella SQL Editor di ogni GAL.
