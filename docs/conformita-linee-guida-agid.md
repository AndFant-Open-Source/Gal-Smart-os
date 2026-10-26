<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Conformità alle Linee guida AgID su acquisizione e riuso del software

Verifica di GAL OS rispetto agli artt. 68–69 del CAD (D.Lgs. 82/2005) e alle *Linee guida su
acquisizione e riuso di software per le pubbliche amministrazioni* (AgID), capitolo 3 e Allegati A
(pubblicazione), B (manutenzione) e C (licenze). Stessa impostazione adottata per ProtoGal.

Data della verifica: 26 ottobre 2026 — versione 5.0.0.

Legenda: ✅ conforme · 🟡 predisposto, serve un'azione o una decisione del titolare · ❌ non
conforme · — non applicabile. "MUST", "SHOULD" e "MAY" sono i livelli di obbligo delle Linee guida.

## Sintesi

Il software è **tecnicamente pronto per il rilascio come software libero**. Restano adempimenti
**non tecnici** del titolare:

1. pubblicare il codice in un **repository pubblico** (art. 69 c. 1);
2. compilare i campi `[DA INDICARE]` (manutentore, e-mail di sicurezza);
3. **registrare** il software su Developers Italia (art. 69 c. 2-bis; All. A §A.11).

## Art. 69 CAD — obblighi di riuso

| Requisito | Stato | Note |
|-----------|:---:|------|
| Codice sorgente in repertorio pubblico (c. 1) | 🟡 | Da pubblicare su GitHub (repository pubblico) |
| Rilasciato sotto licenza aperta (c. 1) | ✅ | AGPL-3.0-or-later (approvata OSI) con termini aggiuntivi ammessi dalla sezione 7 |
| Completo della documentazione (c. 1) | ✅ | README, `docs/`, `supabase/README.md` |
| Titolarità dei diritti (c. 2) | ✅ | Andrea Fantini; vedi [licenza-e-titolarita.md](licenza-e-titolarita.md) §4 |
| Pubblicazione su Developers Italia (c. 2-bis) | 🟡 | `publiccode.yml` pronto; registrazione da fare |

## Allegato A — Pubblicazione come open source

| § | Requisito | Livello | Stato | Note |
|---|-----------|:---:|:---:|------|
| A.2 | Piattaforma di code hosting conforme | MUST | ✅ | GitHub |
| A.2 | Accesso in lettura senza autenticazione | MUST | ✅ | Repository `AndFant-Open-Source/Gal-Smart-os` (verificare che sia pubblico) |
| A.2 | Area intestata al progetto, non all'incaricato | MUST | 🟡 | Consigliata un'organizzazione GitHub (es. `AndFant-Open-Source`) |
| A.2 | Link al repository nell'interfaccia pubblica | MUST | ✅ | A piè di pagina, nella pagina di accesso e in *Copyright e licenza*, con versione e licenza |
| A.3 | Compatibilità della licenza con i componenti di terzi | MUST | ✅ | Dipendenze di produzione con licenze MIT, ISC, Apache-2.0, BSD |
| A.4 | File `LICENSE` con testo integrale | MUST | ✅ | Testo ufficiale GNU AGPL v3, non modificato |
| A.4 | Codice SPDX all'inizio di ogni file sorgente | MUST | ✅ | Tutti i file `.ts`, `.tsx`, `.css`, `.js`, `.mjs`, `.sql`, `.html`, `.yml`; `REUSE.toml` per gli altri |
| A.4 | Titolare dei diritti indicato | MUST | ✅ | In ogni file sorgente e in `REUSE.toml` |
| A.5 | Codice, struttura DB, script di installazione, documentazione | MUST | ✅ | Struttura DB in un unico `supabase/schema.sql` |
| A.5 | Esclusione dei dati di produzione | MUST | ✅ | Nessun dato reale; `.env`, ZIP ed Excel esclusi da git |
| A.6 | Codice integrale, leggibile, non offuscato | MUST | ✅ | TypeScript leggibile; la minificazione riguarda solo la build |
| A.6 | Codice indentato e commentato, stile coerente | MUST | ✅ | |
| A.6 | Struttura delle cartelle chiara | MUST | ✅ | Vedi [architettura.md](architettura.md) |
| A.6 | Specificità dell'ente configurabili | SHOULD | ✅ | Nome del GAL e dati anagrafici da variabili e da *Impostazioni*; nessun dato di un ente nel codice |
| A.6 | Uso di package manager | SHOULD | ✅ | npm con `package-lock.json` |
| A.7 | README completo | MUST | 🟡 | Restano i segnaposto di manutentore ed e-mail; aggiungere le schermate |
| A.7 | Link a Continuous Integration | SHOULD | ✅ | `.github/workflows/ci.yml`: tipi, prova del database, compilazione |
| A.8 | Documentazione di installazione, sviluppo, produzione, architettura | MUST | ✅ | `docs/installazione.md`, `docs/architettura.md`, `docs/migrazione-dati.md` |
| A.8 | Documentazione in formato testuale versionabile | MUST | ✅ | Markdown |
| A.9 | Rilascio contestuale allo sviluppo o entro 15 giorni dall'uso in produzione | MUST | 🟡 | Pubblicare prima della messa in produzione presso i GAL |
| A.10 | Nessuna credenziale nel repository, anche nella storia | MUST | ✅ | Repository nuovo; verificata anche la storia del progetto di origine: solo segnaposto |
| A.10 | Rimozione del codice morto | MUST | ✅ | Rimossi ricerca Tauri, stub, librerie inutilizzate |
| A.10 | `/.well-known/security.txt` | SHOULD | 🟡 | Presente; compilare e-mail e indirizzo |
| A.11 | `publiccode.yml` nella radice | MUST | 🟡 | Presente; compilare referente ed e-mail |
| A.11 | Registrazione su Developers Italia | MUST | 🟡 | Dopo la pubblicazione |

## Allegato B — Manutenzione

| Requisito | Stato | Note |
|-----------|:---:|------|
| Modifiche pubblicate nel repository prima della produzione | ✅ | I siti dei GAL si aggiornano solo da GitHub (fork + Cloudflare Pages) |
| Aggiornamento delle dipendenze, priorità ai fix di sicurezza | ✅ | Ottobre 2026: corretti jsPDF (critica), dompurify (alta), SheetJS; restano 2 avvisi moderati su react-router (vedi [analisi-sicurezza.md](analisi-sicurezza.md)) |
| Ruolo di manutentore indicato | 🟡 | Segnaposto in README e `publiccode.yml` |
| Risposta alle segnalazioni entro 2 giorni lavorativi | 🟡 | Organizzativo: attivare le Issues e definire chi risponde |

## Allegato C — Licenze

| Requisito | Stato | Note |
|-----------|:---:|------|
| Licenza certificata OSI | ✅ | AGPL-3.0 |
| Licenza consigliata per software usato via rete | ✅ | AGPL-3.0-or-later (§3.5.3) |
| Documentazione sotto CC-BY-4.0 | ✅ | Indicato in `REUSE.toml` |
| Identificazione con codice SPDX | ✅ | |

## Altri obblighi da considerare (fuori dalle Linee guida sul riuso)

- **Accessibilità** (L. 4/2004, Linee guida AgID): lingua della pagina, etichette dei campi
  principali, collegamento "Vai al contenuto" e nomi accessibili dei pulsanti a icona sono presenti;
  manca una verifica WCAG 2.1 AA completa e la **dichiarazione di accessibilità** da pubblicare
  tramite AgID.
- **Protezione dei dati** (GDPR): il gestionale contiene dati personali (soci, fornitori,
  beneficiari, componenti degli organi). Ogni GAL indica il trattamento nel registro e nomina
  Supabase e Cloudflare responsabili del trattamento; regione dati consigliata Frankfurt (UE).
- **Conservazione documentale**: GAL OS non è un sistema di conservazione a norma; i documenti
  rilevanti vanno conservati secondo le regole dell'ente.
