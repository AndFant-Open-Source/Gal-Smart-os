<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# GAL OS — edizione per singolo GAL

**Il gestionale del Gruppo di Azione Locale: una piattaforma e un database per ogni GAL**

GAL OS è un'applicazione web per la gestione amministrativa di un **Gruppo di Azione Locale (GAL)**:
bandi e domande di sostegno, organi sociali, rendicontazione delle spese, procedure di acquisto,
scadenze, pagamenti e cassa. Si usa dal browser, senza installare programmi.

**In questa edizione ogni GAL ha la propria piattaforma**: un proprio progetto Supabase (database,
utenti e archivio file), un proprio account GitHub/Cloudflare e un proprio sito. Non esiste una
gestione di più GAL: nessun utente, nemmeno l'amministratore, può vedere o gestire un ente diverso
dal proprio, perché i dati stanno su server separati. Dentro la piattaforma lavorano solo le persone
del GAL (anche una sola), con i ruoli amministratore, operatore e lettore.

## A cosa serve

| Area | Funzioni principali |
|------|---------------------|
| **Agenda scadenze** | Pratiche per Segreteria, Direttore Tecnico e RAF, con check list, diario, allegati, calendario e ricorrenze |
| **Scadenzario pagamenti** | Lettura della fattura elettronica XML, verifica di CUP e CIG, registrazione del bonifico, F24 automatici entro il 16 del mese successivo, scheda per il mandato di pagamento in PDF |
| **Cash flow** | Conti, incassi, previsione mensile della liquidità, avviso di tensione di cassa |
| **Bandi** | Bandi, domande di sostegno, pagamenti, importazione del monitoraggio |
| **Organi sociali** | Libro soci, quote, organi, sedute, delibere |
| **Rendicontazione** | Giustificativi di spesa, fornitori, previsione, quadro di rendicontazione, report SES |
| **Procedure di acquisto** | Procedure, operatori invitati, contratti, calcolo delle soglie |
| **Archivio** | Registro di catalogazione dei fascicoli con controllo di codice fiscale e partita IVA |
| **Esportazione** | Tutti i dati in un file Excel con una tabella per sezione; backup completo in ZIP |

**Casi d'uso tipici**

- La segreteria apre una pratica "Convocazione CdA", applica il modello di check list e spunta i
  passaggi: il calendario mostra la scadenza insieme ai pagamenti del mese.
- Il RAF carica la fattura XML di un consulente: CUP, CIG, ritenuta e split payment si compilano da
  soli; registrato il bonifico nasce la scadenza F24 e si scarica la scheda per il mandato.
- Un nuovo GAL adotta il programma: crea il proprio progetto Supabase, esegue lo schema e pubblica
  il sito con Cloudflare Pages dal proprio account (guida: [docs/installazione.md](docs/installazione.md)).

## Documentazione

| Documento | Contenuto |
|-----------|-----------|
| [docs/installazione.md](docs/installazione.md) | Installazione per un nuovo GAL: Supabase, GitHub, Cloudflare Pages |
| [docs/migrazione-dati.md](docs/migrazione-dati.md) | Come portare i dati dalla versione multi-GAL o dalla versione locale |
| [docs/architettura.md](docs/architettura.md) | Come è fatto il software e dove stanno le regole di sicurezza |
| [docs/analisi-sicurezza.md](docs/analisi-sicurezza.md) | Falle trovate nella versione precedente e correzioni |
| [supabase/README.md](supabase/README.md) | Struttura del database, permessi e regole |
| [docs/licenza-e-titolarita.md](docs/licenza-e-titolarita.md) | Licenza, titolarità e passi per il rilascio |
| [docs/conformita-linee-guida-agid.md](docs/conformita-linee-guida-agid.md) | Verifica rispetto alle Linee guida AgID sul riuso |
| [SECURITY.md](SECURITY.md) | Come segnalare un problema di sicurezza |

## Struttura del repository

```
src/                 codice dell'applicazione (React + TypeScript)
supabase/            schema completo del database (schema.sql)
test/                prova automatica dello schema e delle regole di sicurezza
docs/                documentazione
public/              intestazioni di sicurezza (_headers) e .well-known/security.txt
LICENSES/            testi delle licenze (AGPL-3.0, CC-BY-4.0, MIT)
publiccode.yml       scheda per il catalogo Developers Italia
REUSE.toml           licenza e titolarità di ogni file
```

Ramo unico `main`: ogni modifica sul ramo principale viene pubblicata in produzione dai siti
Cloudflare collegati.

## Prerequisiti e dipendenze

- **Node.js 20+** e npm (solo per compilare)
- **Supabase**: database PostgreSQL, autenticazione e archivio file. È software libero
  (Apache-2.0): si può usare il servizio cloud o installarlo sui propri server
- **Hosting di file statici**: Cloudflare Pages (consigliato), o qualsiasi server web

Librerie principali: React, Tailwind CSS, Supabase JS, jsPDF, SheetJS, JSZip, Recharts, date-fns,
Zustand. **Nessuna dipendenza da software commerciale**: tutte le librerie sono software libero (MIT,
ISC, Apache-2.0, BSD). L'elenco completo è in `package.json`.

## Installazione rapida (sviluppo)

```bash
git clone https://github.com/AndFant-Open-Source/Gal-Smart-os.git
cd Gal-Smart-os
npm install
cp .env.example .env     # compilare con i dati del progetto Supabase del GAL
npm run dev              # http://localhost:5173
npm run test:db          # prova dello schema e delle regole di sicurezza
```

Prima del primo avvio va eseguito lo schema del database: procedura completa in
[docs/installazione.md](docs/installazione.md).

## Stato del progetto

**Beta** — derivato da GAL OS 4.0 (versione multi-GAL), in uso presso [ENTI DA INDICARE].

Limitazioni note:

- Gli utenti si creano su invito dalla dashboard di Supabase; dall'app si attivano e si assegnano
  ruolo e funzione.
- Il calcolo della scadenza F24 sposta il 16 al lunedì se cade nel fine settimana e applica la
  proroga di agosto al 20; non considera le festività infrasettimanali.
- Test automatici presenti per il database (`npm run test:db`); non ancora per l'interfaccia.

## Titolarità, licenza e manutenzione

- **Titolare dei diritti**: Andrea Fantini — © 2026
- **Licenza**: software libero rilasciato sotto **GNU Affero General Public License v3.0 o
  successive** (`AGPL-3.0-or-later`, testo ufficiale in [LICENSE](LICENSE)) **con i termini
  aggiuntivi** previsti dalla sezione 7 e descritti in [TERMINI-AGGIUNTIVI.md](TERMINI-AGGIUNTIVI.md):
  - chi usa o ridistribuisce il programma deve mantenere nell'interfaccia l'avviso
    *"GAL OS © 2026 Andrea Fantini — software libero AGPL-3.0"* (oppure *"Basato su GAL OS …"*
    per le versioni modificate);
  - le versioni modificate devono essere riconoscibili come tali e non presentarsi come l'originale;
  - le versioni modificate distribuite a terzi devono avere un nome diverso da "GAL OS".

  Chiunque, comprese le pubbliche amministrazioni, può usare, studiare, modificare e ridistribuire
  il programma gratuitamente; chi lo modifica e lo rende disponibile via rete deve pubblicare il
  codice delle modifiche. La documentazione è rilasciata sotto **Creative Commons Attribuzione 4.0**
  (`CC-BY-4.0`).
- **Manutenzione**: [MANUTENTORE DA INDICARE]
- **Segnalazioni di sicurezza**: **non usare le issue pubbliche**. Scrivere in forma riservata a
  [E-MAIL SICUREZZA DA INDICARE] (vedi [SECURITY.md](SECURITY.md)).
