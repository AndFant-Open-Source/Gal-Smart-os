// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import type {
  Funzione, PrioritaPratica, StatoPratica, Ricorrenza,
  TipoScadenzaPagamento, StatoScadenzaPagamento, ModalitaPagamento, TipoConto,
  StatoSchemaBando, StatoFaseSchema,
} from "../types";

// ─── Schemi di bando (iter Regione Lazio) ────────────────────────
export const STATO_SCHEMA_LABELS: Record<StatoSchemaBando, string> = {
  in_corso: "In corso",
  pubblicato: "Pubblicato",
  sospeso: "Sospeso",
  annullato: "Annullato",
};

export const STATO_SCHEMA_COLORS: Record<StatoSchemaBando, string> = {
  in_corso: "bg-blue-100 text-blue-800",
  pubblicato: "bg-green-100 text-green-800",
  sospeso: "bg-yellow-100 text-yellow-800",
  annullato: "bg-gray-200 text-gray-700",
};

export const STATO_FASE_LABELS: Record<StatoFaseSchema, string> = {
  da_fare: "Da fare",
  in_corso: "In corso",
  completata: "Completato",
  non_applicabile: "Non applicabile",
};

export const STATO_FASE_COLORS: Record<StatoFaseSchema, string> = {
  da_fare: "bg-gray-100 text-gray-700",
  in_corso: "bg-blue-100 text-blue-800",
  completata: "bg-green-100 text-green-800",
  non_applicabile: "bg-gray-50 text-gray-500 border border-dashed border-gray-300",
};

/**
 * Guida di ogni passaggio (flusso operativo Regione Lazio, SRG06 – Sottointervento A).
 * "riferimento" è l'etichetta del campo in cui annotare gli estremi del documento.
 */
export const GUIDA_FASI_SCHEMA: Record<number, { cosa: string; riferimento: string }> = {
  1: {
    cosa: "Il GAL predispone la bozza del bando e la invia per e-mail ai referenti regionali, chiedendo osservazioni e indicazioni per arrivare a una versione condivisa.",
    riferimento: "Data e oggetto dell'e-mail / versione della bozza",
  },
  2: {
    cosa: "Il Direttore Tecnico predispone la profilatura VECI per l'intervento/azione e chiede alla Regione, per e-mail, la validazione a sistema indicando nell'oggetto intervento e azione.",
    riferimento: "Oggetto dell'e-mail di richiesta validazione",
  },
  3: {
    cosa: "Il CdA del GAL approva formalmente lo schema condiviso con la Regione. Schema e verbale del CdA vengono inviati alla Regione via PEC.",
    riferimento: "N. e data della delibera CdA / protocollo PEC",
  },
  4: {
    cosa: "Acquisita la delibera del CdA, la Regione emana l'atto amministrativo che approva e valida ufficialmente lo schema di bando.",
    riferimento: "N. e data dell'atto regionale (determinazione)",
  },
  5: {
    cosa: "Recepito l'atto regionale, il CdA approva il bando definitivo, perfettamente conforme allo schema validato. Il bando approvato va poi gestito in «Bandi attivi».",
    riferimento: "N. e data della delibera CdA di approvazione definitiva",
  },
  6: {
    cosa: "Il Direttore Tecnico inserisce i parametri del bando definitivo sul portale SIAN e comunica per e-mail ai referenti regionali l'avvenuta profilazione, chiedendo la convalida.",
    riferimento: "Codice/ID del bando sul SIAN e data dell'e-mail",
  },
  7: {
    cosa: "Ricevuta la comunicazione, la Regione effettua sul portale SIAN la convalida definitiva del bando inserito dal GAL.",
    riferimento: "Data della convalida SIAN",
  },
  8: {
    cosa: "Dopo la convalida regionale, il GAL (Presidente, DT e Segreteria) pubblica il bando approvato sui propri siti istituzionali.",
    riferimento: "Indirizzo della pagina di pubblicazione",
  },
  9: {
    cosa: "Solo se i contributi sono concessi in regime de minimis: il DT trasmette per e-mail alla Regione modulistica e informazioni per registrare la misura nel Registro Nazionale Aiuti.",
    riferimento: "Codice misura RNA (CAR) / data dell'e-mail",
  },
};

// ─── Agenda ──────────────────────────────────────────────────────
export const FUNZIONI: Funzione[] = ["segreteria", "direttore_tecnico", "raf"];

export const FUNZIONE_LABELS: Record<Funzione, string> = {
  segreteria: "Segreteria",
  direttore_tecnico: "Direttore Tecnico",
  raf: "RAF",
};

export const FUNZIONE_COLORS: Record<Funzione, string> = {
  segreteria: "bg-sky-100 text-sky-700 border-sky-200",
  direttore_tecnico: "bg-violet-100 text-violet-700 border-violet-200",
  raf: "bg-amber-100 text-amber-700 border-amber-200",
};

export const PRIORITA_LABELS: Record<PrioritaPratica, string> = {
  bassa: "Bassa",
  media: "Media",
  alta: "Alta",
  urgente: "Urgente",
};

export const PRIORITA_COLORS: Record<PrioritaPratica, string> = {
  bassa: "bg-gray-100 text-gray-600",
  media: "bg-blue-100 text-blue-700",
  alta: "bg-orange-100 text-orange-700",
  urgente: "bg-red-100 text-red-700",
};

export const STATO_PRATICA_LABELS: Record<StatoPratica, string> = {
  aperta: "Aperta",
  in_corso: "In corso",
  sospesa: "Sospesa",
  completata: "Completata",
  annullata: "Annullata",
};

export const STATO_PRATICA_COLORS: Record<StatoPratica, string> = {
  aperta: "bg-blue-100 text-blue-700",
  in_corso: "bg-yellow-100 text-yellow-700",
  sospesa: "bg-gray-200 text-gray-600",
  completata: "bg-green-100 text-green-700",
  annullata: "bg-gray-100 text-gray-400",
};

export const RICORRENZA_LABELS: Record<Ricorrenza, string> = {
  nessuna: "Nessuna",
  mensile: "Mensile",
  trimestrale: "Trimestrale",
  semestrale: "Semestrale",
  annuale: "Annuale",
};

export const CATEGORIE_PRATICA: { value: string; label: string }[] = [
  { value: "organi_sociali", label: "Organi sociali (CdA, Assemblea)" },
  { value: "bandi", label: "Bandi e istruttorie" },
  { value: "rendicontazione", label: "Rendicontazione / Domande di pagamento" },
  { value: "acquisti", label: "Procedure di acquisto" },
  { value: "contabilita", label: "Contabilità e bilancio" },
  { value: "fiscale", label: "Adempimenti fiscali e contributivi" },
  { value: "personale", label: "Personale" },
  { value: "trasparenza", label: "Trasparenza e anticorruzione" },
  { value: "monitoraggio", label: "Monitoraggio e controlli" },
  { value: "comunicazione", label: "Comunicazione / Animazione" },
  { value: "altro", label: "Altro" },
];

export function categoriaLabel(value: string): string {
  return CATEGORIE_PRATICA.find((c) => c.value === value)?.label ?? value;
}

/** Modelli di checklist pronti da applicare alla nuova pratica */
export const MODELLI_CHECKLIST: { nome: string; categoria: string; voci: string[] }[] = [
  {
    nome: "Convocazione CdA / Assemblea",
    categoria: "organi_sociali",
    voci: [
      "Predisporre ordine del giorno",
      "Inviare convocazione nei termini statutari",
      "Preparare documentazione per i punti all'OdG",
      "Verificare quorum costitutivo",
      "Redigere verbale",
      "Pubblicare delibere in Amministrazione Trasparente",
    ],
  },
  {
    nome: "Domanda di pagamento (SAL / Saldo)",
    categoria: "rendicontazione",
    voci: [
      "Raccogliere giustificativi di spesa e quietanze",
      "Verificare CUP/CIG su tutti i documenti",
      "Predisporre quadro di rendicontazione",
      "Acquisire DURC e documentazione antimafia",
      "Compilare domanda sul portale",
      "Rilasciare e protocollare la domanda",
    ],
  },
  {
    nome: "Procedura di affidamento",
    categoria: "acquisti",
    voci: [
      "Determina a contrarre",
      "Acquisire CIG",
      "Richiesta preventivi / pubblicazione avviso",
      "Verifica requisiti art. 94-98 D.Lgs. 36/2023",
      "Provvedimento di affidamento",
      "Stipula contratto / lettera d'ordine",
      "Pubblicazione in Amministrazione Trasparente",
    ],
  },
  {
    nome: "Pubblicazione bando",
    categoria: "bandi",
    voci: [
      "Approvazione bando in CdA",
      "Verifica di conformità con l'Autorità di Gestione",
      "Pubblicazione sul sito e BUR",
      "Attivazione bando sul portale",
      "Animazione territoriale / incontri informativi",
    ],
  },
  {
    nome: "Chiusura bilancio",
    categoria: "contabilita",
    voci: [
      "Riconciliazione conti bancari",
      "Rilevazione ratei e risconti",
      "Bozza di bilancio",
      "Relazione del revisore / collegio sindacale",
      "Approvazione in Assemblea",
      "Deposito al Registro Imprese",
    ],
  },
];

// ─── Scadenzario pagamenti ──────────────────────────────────────
export const TIPO_SCADENZA_LABELS: Record<TipoScadenzaPagamento, string> = {
  fattura: "Fattura",
  parcella: "Parcella / Notula professionale",
  f24: "F24 (ritenute / tributi)",
  stipendio: "Stipendi e compensi",
  utenza: "Utenza",
  canone: "Canone / Locazione",
  rimborso: "Rimborso spese",
  altro: "Altro",
};

export const STATO_SCADENZA_LABELS: Record<StatoScadenzaPagamento, string> = {
  da_pagare: "Da pagare",
  in_pagamento: "In pagamento",
  pagata: "Pagata",
  annullata: "Annullata",
};

export const STATO_SCADENZA_COLORS: Record<StatoScadenzaPagamento, string> = {
  da_pagare: "bg-blue-100 text-blue-700",
  in_pagamento: "bg-yellow-100 text-yellow-700",
  pagata: "bg-green-100 text-green-700",
  annullata: "bg-gray-100 text-gray-400",
};

export const MODALITA_PAGAMENTO_LABELS: Record<ModalitaPagamento, string> = {
  bonifico: "Bonifico bancario",
  f24: "Modello F24",
  rid: "Addebito diretto (RID/SDD)",
  carta: "Carta di pagamento",
  contanti: "Contanti",
  altro: "Altro",
};

export const TIPO_CONTO_LABELS: Record<TipoConto, string> = {
  conto_corrente: "Conto corrente",
  conto_dedicato: "Conto dedicato (L. 136/2010)",
  cassa: "Cassa contanti",
  carta: "Carta prepagata / di credito",
};

/** Codici tributo più comuni per le ritenute versate con F24 */
export const CODICI_TRIBUTO_RITENUTA: { value: string; label: string }[] = [
  { value: "1040", label: "1040 — Ritenute su redditi di lavoro autonomo" },
  { value: "1001", label: "1001 — Ritenute su retribuzioni e compensi" },
  { value: "1004", label: "1004 — Ritenute su conguagli redditi assimilati" },
  { value: "1038", label: "1038 — Ritenute su provvigioni" },
  { value: "1019", label: "1019 — Ritenute 4% condominio / enti" },
  { value: "altro", label: "Altro codice tributo" },
];

/** Motivazioni ammesse per l'esclusione del CIG (Determinazione ANAC 4/2011 e s.m.i.) */
export const MOTIVI_ESENZIONE_CIG: string[] = [
  "Pagamento di stipendi, compensi a dipendenti e oneri riflessi",
  "Pagamento di tributi, imposte, contributi (F24)",
  "Utenze e servizi a tariffa regolata",
  "Rimborsi spese a organi sociali / personale",
  "Incarico di collaborazione ex art. 2222 c.c. (non appalto)",
  "Spese di funzionamento non riconducibili ad appalto",
  "Altro (specificare nelle note)",
];

// ─── Cash flow ──────────────────────────────────────────────────
export const CATEGORIE_ENTRATA: { value: string; label: string }[] = [
  { value: "anticipo", label: "Anticipo contributo pubblico" },
  { value: "sal", label: "SAL / Domanda di pagamento" },
  { value: "saldo", label: "Saldo contributo pubblico" },
  { value: "quote_soci", label: "Quote associative / Capitale sociale" },
  { value: "cofinanziamento", label: "Cofinanziamento privato" },
  { value: "rimborso", label: "Rimborsi / Restituzioni" },
  { value: "interessi", label: "Interessi attivi" },
  { value: "altro", label: "Altre entrate" },
];

export const CATEGORIE_USCITA: { value: string; label: string }[] = [
  { value: "commissioni", label: "Commissioni e spese bancarie" },
  { value: "imposte", label: "Imposte e tasse" },
  { value: "restituzione", label: "Restituzioni" },
  { value: "altro", label: "Altre uscite" },
];

export function categoriaMovimentoLabel(value: string): string {
  return [...CATEGORIE_ENTRATA, ...CATEGORIE_USCITA].find((c) => c.value === value)?.label ?? value;
}

export const MESI_BREVI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

/** Bucket di Storage privato già usato dall'app */
export const BUCKET_DOCUMENTI = "documenti_gal";
