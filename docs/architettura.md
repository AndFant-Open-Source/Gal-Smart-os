<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Architettura

Descrizione per chi vuole riusare, integrare o modificare GAL OS
(Linee guida AgID, Allegato A §A.8).

## Schema generale

```
Browser (React + TypeScript, file statici su Cloudflare Pages)
   │  HTTPS — chiave pubblica "anon" + sessione dell'utente
   ▼
Supabase del GAL (un progetto per ogni GAL)
   ├── Auth ........ accesso con e-mail e password; utenti solo su invito
   ├── PostgreSQL .. tabelle gal_*, Row Level Security, trigger, funzioni
   └── Storage ..... bucket privato "documenti_gal" (URL firmati temporanei)
```

Non esiste un server applicativo proprio: **tutte le regole di sicurezza stanno nel database**
(policy RLS, trigger e funzioni `SECURITY DEFINER` con `search_path` fisso). L'interfaccia nasconde
i comandi non consentiti, ma è il database a impedirli: chi chiamasse direttamente le API con la
chiave pubblica otterrebbe gli stessi rifiuti.

## Edizione per singolo GAL

- Il database contiene **una sola** riga in `gal_gal` (indice unico su un'espressione costante).
- Le tabelle conservano la colonna `gal_id` per compatibilità con i backup delle versioni
  precedenti: il valore predefinito è `gal_id_unico()` e i vincoli di chiave esterna impediscono
  qualsiasi altro valore.
- Non esistono "amministratori globali" né cambio di GAL nell'interfaccia.

## Regole applicate dal database

| Regola | Dove |
|--------|------|
| Vede i dati solo chi ha un profilo attivo | `gal_utente_attivo()` in tutte le policy di lettura |
| Inserimento e modifica: amministratore e operatore | `gal_is_operatore()` |
| Eliminazione dei registri principali: solo amministratore; dei dettagli: anche operatore | policy `eliminazione` generate nello schema |
| Nuovi account disattivati; attivazione e ruolo solo dall'amministratore | trigger `gal_on_auth_user_created`, `gal_profili_protetti` |
| Sempre almeno un amministratore attivo | trigger `gal_profili_ultimo_admin` |
| Registro attività a nome di chi agisce, non modificabile | policy su `gal_audit` |
| CUP obbligatorio, CIG o motivo di esclusione obbligatorio | vincoli su `gal_scadenze_pagamento` |
| Numero di mandato e numero di fascicolo unici | indici unici |

## Struttura del codice

```
src/
  App.tsx                rotte (pagine caricate su richiesta) e controllo dei ruoli
  main.tsx               avvio
  components/
    layout/MainLayout    menu, intestazione, note legali a piè di pagina
    InfoSoftware.tsx     avviso di attribuzione AGPL + link al codice sorgente
    agenda/ scadenzario/ cashflow/   moduli della 4.0
    ui/                  componenti di base (tabella, finestre, conferme, allegati)
  constants/             etichette e modelli (funzioni, stati, codici tributo, check list)
  lib/
    supabase.ts          client Supabase (PKCE, sessione)
    utils.ts             formattazioni, registro attività, messaggi di errore in italiano
    scadenze.ts          calcoli: scadenza F24, ricorrenze, validazione CUP/CIG, netto da pagare
    scadenzario.ts       F24 collegati, allegati, scheda per il mandato (PDF)
    cashflow.ts          flussi, saldi, previsione, tensione di cassa
    fatturaPA.ts         lettura della fattura elettronica XML (anche .p7m)
    excelTabelle.ts      scrittura .xlsx con vere Tabelle Excel
    esportazioneDati.ts  esportazione di tutte le sezioni in Excel
    pdf.ts               report PDF
  pages/                 una pagina per file, raggruppate per area
  stores/                sessione (auth) e dati del GAL
  types/                 tipi TypeScript condivisi
supabase/schema.sql      schema completo del database
test/schema.test.mjs     prova dello schema e delle regole su PostgreSQL in memoria
public/_headers          intestazioni di sicurezza per Cloudflare Pages
```

## Flussi principali

**Pagamento con ritenuta.** Scadenza inserita (con lettura facoltativa della fattura XML) → verifica
CUP/CIG → *Registra pagamento* (conto, CRO, contabile) → `generaF24Collegati()` crea le scadenze F24
per ritenuta e IVA in split payment entro il 16 del mese successivo → scheda per il mandato in PDF.

**Accesso.** `supabase.auth.signInWithPassword` → lettura del profilo: se assente o disattivato
l'accesso è negato e la sessione chiusa. All'avvio la sessione salvata viene ricontrollata.

**Invito e password.** Invito dalla dashboard Supabase → e-mail con link a `/nuova-password` →
l'utente sceglie la password → l'amministratore lo attiva in *Utenti*.
