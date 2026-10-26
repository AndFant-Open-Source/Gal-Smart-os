<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Analisi di sicurezza e migliorie (riprogettazione 5.0)

Verifica della versione di partenza (GAL OS 4.0 multi-GAL e GAL Smart Local 1.1) eseguita durante
la riprogettazione per singolo GAL, ottobre 2026. Per ogni problema: gravità, effetto e correzione.

Legenda gravità: 🔴 alta · 🟠 media · 🟡 bassa.

## Falle corrette

| # | Gravità | Problema nella versione 4.0 | Correzione nella 5.0 |
|---|:---:|------------------------------|----------------------|
| 1 | 🔴 | Le regole RLS permettevano la **lettura a qualsiasi utente autenticato**. Con la registrazione libera attiva (impostazione predefinita di Supabase) chiunque poteva creare un account e leggere tutti i dati | Lettura solo con **profilo attivo** (`gal_utente_attivo()`); i nuovi account nascono disattivati; il ruolo `anon` non ha accesso alle tabelle. Verificato da `npm run test:db` |
| 2 | 🔴 | Più GAL nello stesso database: un errore di filtro o di policy avrebbe esposto i dati di un ente agli altri | Un progetto Supabase per GAL; il database accetta **una sola** anagrafica (`gal_gal_una_sola_riga`) |
| 3 | 🔴 | Archivio file (`documenti_gal`) senza regole nello schema: sicurezza affidata a impostazioni manuali | Bucket privato con policy esplicite (lettura utenti attivi, scrittura operatori), limite 50 MB |
| 4 | 🔴 | Lo schema nel repository era **incompleto** (mancavano 7 tabelle usate dal codice: contratti, interventi, tipologie, capitoli, documenti dei giustificativi…): una nuova installazione non funzionava | Unico `supabase/schema.sql` completo (32 tabelle), idempotente, provato automaticamente |
| 5 | 🟠 | Il **registro attività non veniva mai salvato**: il codice scriveva nella tabella inesistente `gal_audit_events` | Scrittura in `gal_audit`; evento sempre a nome di chi lo crea; non modificabile né eliminabile |
| 6 | 🟠 | I **pagamenti delle domande di sostegno** non venivano salvati: tabella inesistente `gal_pagamenti_bandi` | Corretto in `gal_pagamenti_bando` |
| 7 | 🟠 | Gestione utenti tramite **registrazione pubblica** (`signUp`) dal browser e reimpostazione password non funzionante | Utenti solo su invito; attivazione, ruolo e funzione dall'app; reimpostazione password via e-mail; pagina "Imposta password" |
| 8 | 🟠 | Un utente poteva modificare il proprio profilo (anche ruolo e stato) se le policy lo consentivano | Trigger nel database: ruolo, stato e funzione li cambia solo l'amministratore; sempre almeno un amministratore attivo |
| 9 | 🟠 | **Backup incompleto**: i pagamenti delle domande erano filtrati su una colonna inesistente (mai esportati) e ogni tabella era troncata a 1000 righe senza avviso; esclusi gli allegati delle pratiche dell'Agenda | Esportazione a blocchi di tutte le righe, tutte le tabelle, anche gli allegati dell'Agenda |
| 10 | 🟠 | Dipendenze con vulnerabilità note: **jsPDF** (critica, iniezione di oggetti PDF), **dompurify** (alta), **SheetJS 0.18.5** da npm (non più aggiornato) | jsPDF 4.2.1, dompurify aggiornato, SheetJS 0.20.3 dal canale ufficiale |
| 11 | 🟡 | 66 messaggi mostravano all'utente **errori tecnici** del database in inglese | Funzione unica `messaggioErrore()`: messaggio in italiano, dettaglio solo nella console |
| 12 | 🟡 | Sessione utente (con il ruolo) salvata nel browser e considerata valida anche se scaduta | All'avvio si verifica la sessione con Supabase e si rilegge il profilo; ruolo mai preso dal browser |
| 13 | 🟡 | Caratteri caricati da **Google Fonts** a ogni accesso (trasferimento dell'indirizzo IP a terzi) | Caratteri di sistema; nessuna risorsa esterna, imposto dalla politica dei contenuti (CSP) |
| 14 | 🟡 | Nessuna intestazione di sicurezza sul sito | `public/_headers`: CSP, X-Frame-Options, HSTS, nosniff, Referrer-Policy, Permissions-Policy |
| 15 | 🟡 | Codice morto: ricerca globale legata a Tauri (non funzionante), stub Tauri, librerie non usate (zod, react-hook-form) | Rimossi (Linee guida AgID, All. A §A.10) |
| 16 | 🟡 | Scadenzario: CUP/CIG obbligatori solo nell'interfaccia; numero di mandato duplicabile | Vincoli nel database: CUP obbligatorio, CIG o motivo di esclusione obbligatorio, mandato unico |
| 17 | 🟡 | Registro di catalogazione: numero di fascicolo duplicabile sul web | Indice unico nel database |
| 18 | 🟡 | Un unico file JavaScript da 2,3 MB a ogni accesso | Pagine caricate su richiesta e librerie separate: primo caricamento circa 125 KB compressi (prima 670 KB) |

## Verifiche automatiche

`npm run test:db` esegue lo schema due volte su PostgreSQL (PGlite) simulando Supabase e controlla 37
regole, tra cui: account non attivo senza accesso, anonimo senza accesso, operatore che non elimina
né si promuove, ultimo amministratore protetto, registro attività immutabile, vincoli CUP/CIG,
mandato e fascicolo unici, archivio file privato, RLS attiva su tutte le tabelle.

## Migliorie consigliate (non ancora fatte)

- **React Router 7**: restano due avvisi moderati su `react-router` 6 (reindirizzamento con
  barra rovesciata in `<Link>`; idratazione SSR). L'app non usa SSR né naviga verso indirizzi
  inseriti dall'utente, quindi non sono sfruttabili; la correzione richiede l'aggiornamento alla
  versione 7.
- **Numerazione del mandato nel database** (funzione con contatore per anno), come per i protocolli
  di ProtoGal: oggi il numero è proposto dall'app e reso unico dal database.
- **Storico automatico delle eliminazioni** tramite trigger, indipendente dall'app.
- **Test dell'interfaccia** (es. Playwright) e controllo di accessibilità WCAG 2.1 AA con
  dichiarazione di accessibilità (L. 4/2004).
- **Autenticazione a due fattori** (TOTP di Supabase) per gli amministratori.
