<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Registro delle modifiche — GAL OS (edizione per singolo GAL)

Le versioni seguono il [versionamento semantico](https://semver.org/lang/it/).

## [5.0.0] — 2026-10-26

Prima versione dell'**edizione per singolo GAL**, derivata da GAL OS 4.0 (multi-GAL) e da
GAL Smart Local 1.1. Modifiche apportate da Andrea Fantini.

### Cambiato
- **Un database Supabase per ogni GAL**: eliminati la gestione di più GAL, il cambio di GAL e gli
  amministratori globali. Il database accetta una sola anagrafica di GAL.
- **Utenti su invito** dalla dashboard Supabase; attivazione, ruolo e funzione dall'app; pagina
  "Imposta password" per inviti e recupero; "Password dimenticata?" nella pagina di accesso.
- Sessione verificata con Supabase a ogni avvio (il ruolo non viene più letto dal browser).
- Pagine caricate su richiesta: primo caricamento molto più leggero.
- Messaggi di errore in italiano comprensibile in tutta l'applicazione.

### Aggiunto
- Schema del database **completo** e rieseguibile (`supabase/schema.sql`) con Row Level Security
  basata sul profilo attivo, archivio file privato e regole di contenuto (CUP/CIG, mandato e
  fascicolo unici).
- Prova automatica dello schema e delle regole (`npm run test:db`) e Continuous Integration.
- Note legali AGPL (avviso di attribuzione, versione, link al codice) e pagina *Copyright e licenza*.
- File per il riuso secondo le Linee guida AgID: `LICENSE`, `TERMINI-AGGIUNTIVI.md`,
  `publiccode.yml`, `REUSE.toml`, `SECURITY.md`, `security.txt`, intestazioni SPDX.
- Intestazioni di sicurezza per Cloudflare Pages (`public/_headers`).
- Registro di catalogazione ed esportazione in Excel (dalla versione locale).
- Allegati delle pratiche dell'Agenda inclusi nel backup.

### Corretto
- Il registro attività non veniva salvato (tabella inesistente `gal_audit_events`).
- I pagamenti delle domande di sostegno non venivano salvati (`gal_pagamenti_bandi`).
- Il backup non esportava i pagamenti delle domande e troncava le tabelle a 1000 righe.
- Dipendenze vulnerabili (jsPDF, dompurify, SheetJS).

### Rimosso
- Ricerca globale legata a Tauri (non funzionante), librerie non usate (zod, react-hook-form),
  caratteri caricati da Google Fonts.
