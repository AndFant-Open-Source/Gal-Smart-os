// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Esportazione di tutto il database in un file Excel con una tabella per sezione.
 * Ogni tabella del database diventa un foglio con il nome della sezione dell'app
 * (Agenda, Scadenzario pagamenti, Previsione, Registro di catalogazione, …).
 */
import { supabase } from "./supabase";
import { creaFileExcel, dataDaIso, type ColonnaExcel, type FoglioExcel, type FormatoColonna, type ValoreCella } from "./excelTabelle";
import {
  FUNZIONE_LABELS, TIPO_SCADENZA_LABELS, categoriaLabel, categoriaMovimentoLabel,
} from "../constants";
import type { Funzione, TipoScadenzaPagamento } from "../types";

export interface SezioneExport {
  tabella: string;
  foglio: string;
  gruppo: string;
  /** Colonne con data/ora da mantenere (created_at è escluso di default) */
  conDataCreazione?: boolean;
}

/** Sezioni nell'ordine in cui compaiono nel file */
export const SEZIONI_EXPORT: SezioneExport[] = [
  { tabella: "gal_agenda_pratiche", foglio: "Agenda", gruppo: "Agenda scadenze" },
  { tabella: "gal_agenda_checklist", foglio: "Agenda - Check list", gruppo: "Agenda scadenze" },
  { tabella: "gal_agenda_note", foglio: "Agenda - Diario", gruppo: "Agenda scadenze", conDataCreazione: true },
  { tabella: "gal_scadenze_pagamento", foglio: "Scadenzario pagamenti", gruppo: "Pagamenti e cassa" },
  { tabella: "gal_movimenti_cassa", foglio: "Incassi e movimenti", gruppo: "Pagamenti e cassa" },
  { tabella: "gal_conti", foglio: "Conti correnti", gruppo: "Pagamenti e cassa" },
  { tabella: "gal_bandi", foglio: "Bandi", gruppo: "Bandi" },
  { tabella: "gal_domande_sostegno", foglio: "Domande di sostegno", gruppo: "Bandi" },
  { tabella: "gal_pagamenti_bando", foglio: "Pagamenti domande", gruppo: "Bandi" },
  { tabella: "gal_soci", foglio: "Libro soci", gruppo: "Organi sociali" },
  { tabella: "gal_quote_sociali", foglio: "Quote sociali", gruppo: "Organi sociali" },
  { tabella: "gal_organi", foglio: "Organi", gruppo: "Organi sociali" },
  { tabella: "gal_componenti", foglio: "Componenti organi", gruppo: "Organi sociali" },
  { tabella: "gal_sedute", foglio: "Sedute", gruppo: "Organi sociali" },
  { tabella: "gal_delibere", foglio: "Delibere", gruppo: "Organi sociali" },
  { tabella: "gal_voci_previsione", foglio: "Previsione", gruppo: "Rendicontazione" },
  { tabella: "gal_giustificativi", foglio: "Giustificativi", gruppo: "Rendicontazione" },
  { tabella: "gal_pagamenti_giust", foglio: "Pagamenti giustificativi", gruppo: "Rendicontazione" },
  { tabella: "gal_righe_imputazione", foglio: "Imputazioni di spesa", gruppo: "Rendicontazione" },
  { tabella: "gal_documenti_giustificativo", foglio: "Documenti giustificativi", gruppo: "Rendicontazione" },
  { tabella: "gal_fornitori", foglio: "Fornitori", gruppo: "Rendicontazione" },
  { tabella: "gal_periodi_ses", foglio: "Periodi SES", gruppo: "Rendicontazione" },
  { tabella: "gal_interventi", foglio: "Interventi", gruppo: "Rendicontazione" },
  { tabella: "gal_tipologie_spesa", foglio: "Tipologie di spesa", gruppo: "Rendicontazione" },
  { tabella: "gal_capitoli", foglio: "Capitoli di spesa", gruppo: "Rendicontazione" },
  { tabella: "gal_procedure", foglio: "Procedure di acquisto", gruppo: "Procedure acquisto" },
  { tabella: "gal_procedure_invitati", foglio: "Operatori invitati", gruppo: "Procedure acquisto" },
  { tabella: "gal_contratti", foglio: "Contratti", gruppo: "Procedure acquisto" },
  { tabella: "gal_fascicoli", foglio: "Registro catalogazione", gruppo: "Archivio" },
  { tabella: "gal_gal", foglio: "Anagrafica GAL", gruppo: "Amministrazione" },
  { tabella: "gal_profili", foglio: "Utenti", gruppo: "Amministrazione" },
  { tabella: "gal_audit", foglio: "Registro attività", gruppo: "Amministrazione", conDataCreazione: true },
];

/** Colonne "…_id" sostituite dal nome leggibile del record collegato */
const COLLEGAMENTI: Record<string, { tabella: string; etichetta: string; testo: (r: Riga) => string }> = {
  pratica_id: { tabella: "gal_agenda_pratiche", etichetta: "Pratica", testo: (r) => [r.codice, r.titolo].filter(Boolean).join(" — ") },
  conto_id: { tabella: "gal_conti", etichetta: "Conto", testo: (r) => String(r.nome ?? "") },
  fornitore_id: { tabella: "gal_fornitori", etichetta: "Fornitore", testo: (r) => String(r.denominazione ?? "") },
  scadenza_origine_id: { tabella: "gal_scadenze_pagamento", etichetta: "Pagamento di origine", testo: (r) => `${r.beneficiario ?? ""} — ${r.descrizione ?? ""}` },
  giustificativo_id: { tabella: "gal_giustificativi", etichetta: "Giustificativo", testo: (r) => `n. ${r.numero_doc ?? ""} del ${formattaData(r.data_doc)} — ${r.fornitore_denominazione ?? ""}` },
  bando_id: { tabella: "gal_bandi", etichetta: "Bando", testo: (r) => [r.numero, r.titolo].filter(Boolean).join(" — ") },
  domanda_id: { tabella: "gal_domande_sostegno", etichetta: "Domanda di sostegno", testo: (r) => [r.codice_agea_ds, r.denominazione].filter(Boolean).join(" — ") },
  socio_id: { tabella: "gal_soci", etichetta: "Socio", testo: (r) => String(r.denominazione ?? "") },
  organo_id: { tabella: "gal_organi", etichetta: "Organo", testo: (r) => String(r.nome ?? "") },
  seduta_id: { tabella: "gal_sedute", etichetta: "Seduta", testo: (r) => `n. ${r.numero ?? ""} del ${formattaData(r.data_seduta)}` },
  periodo_id: { tabella: "gal_periodi_ses", etichetta: "Periodo SES", testo: (r) => [r.codice, r.descrizione].filter(Boolean).join(" — ") },
  intervento_id: { tabella: "gal_interventi", etichetta: "Intervento", testo: (r) => String(r.nome ?? "") },
  tipologia_id: { tabella: "gal_tipologie_spesa", etichetta: "Tipologia di spesa", testo: (r) => String(r.nome ?? "") },
  voce_previsione_id: { tabella: "gal_voci_previsione", etichetta: "Voce di previsione", testo: (r) => String(r.voce ?? "") },
  procedura_id: { tabella: "gal_procedure", etichetta: "Procedura", testo: (r) => [r.codice, r.oggetto].filter(Boolean).join(" — ") },
  user_id: { tabella: "gal_profili", etichetta: "Utente", testo: (r) => String(r.nome_completo ?? "") },
  created_by: { tabella: "gal_profili", etichetta: "Creato da", testo: (r) => String(r.nome_completo ?? "") },
  gal_id: { tabella: "gal_gal", etichetta: "GAL", testo: (r) => String(r.nome ?? "") },
};

/** Colonne tecniche non utili nel foglio */
const ESCLUSE = new Set(["id", "updated_at", "entita_id", "verbale_url", "allegato_url"]);

/** Sigle da scrivere in maiuscolo nelle intestazioni e nei valori */
const SIGLE: Record<string, string> = {
  cig: "CIG", cup: "CUP", iva: "IVA", piva: "P.IVA", iban: "IBAN", cf: "C.F.", pec: "PEC", rup: "RUP",
  ses: "SES", anac: "ANAC", cuaa: "CUAA", agea: "AGEA", ds: "DS", cro: "CRO", trn: "TRN", feasr: "FEASR",
  perc: "%", f24: "F24", sal: "SAL", raf: "RAF", url: "URL", cap: "CAP",
  priorita: "priorità", quantita: "quantità", unita: "unità", modalita: "modalità", attivita: "attività",
  citta: "città", eleggibilita: "eleggibilità",
};

const INTESTAZIONI: Record<string, string> = {
  created_at: "Data inserimento",
  beneficiario_piva: "P.IVA beneficiario",
  beneficiario_cf: "C.F. beneficiario",
  beneficiario_iban: "IBAN beneficiario",
  cup_in_fattura: "CUP in fattura",
  cig_in_fattura: "CIG in fattura",
  cig_esente: "CIG non dovuto",
  cig_motivo_esenzione: "Motivo esclusione CIG",
  cro_trn: "CRO / TRN",
  mandato_numero: "Mandato n.",
  mandato_data: "Data mandato",
  fattura_nome: "File fattura",
  bonifico_nome: "File contabile",
  split_payment: "Split payment",
  ritenuta_codice_tributo: "Codice tributo ritenuta",
  importo_da_pagare: "Netto da pagare",
  numero_fascicolo: "N. fascicolo",
  nome_completo: "Nome e cognome",
  completata_il: "Completata il",
  completata_da: "Completata da",
  verifica_note: "Note di verifica",
  unita_misura: "Unità di misura",
};

/** Campi con valori codificati da rendere leggibili */
const CAMPI_CODIFICATI = new Set([
  "stato", "tipo", "priorita", "categoria", "ricorrenza", "responsabile", "ruolo", "funzione", "modalita_pagamento",
  "modalita", "tipo_doc", "tipo_socio", "tipo_procedura", "esito", "tipo_contratto", "tipo_acconto", "azione", "categoria_spesa",
]);

const EURO = /^(importo|totale|imponibile|saldo|contributo|spesa_|dotazione|ritenuta$|costo|iva$|iva_imputato|iva_richiesta|quota$)/;

type Riga = Record<string, unknown>;

function formattaData(v: unknown): string {
  if (typeof v !== "string") return "";
  const d = dataDaIso(v);
  return d ? d.toLocaleDateString("it-IT") : v;
}

function umanizza(parola: string): string {
  return parola
    .split("_")
    .filter(Boolean)
    .map((t) => SIGLE[t.toLowerCase()] ?? t)
    .join(" ");
}

function maiuscolaIniziale(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function intestazione(col: string): string {
  if (INTESTAZIONI[col]) return INTESTAZIONI[col];
  if (COLLEGAMENTI[col]) return COLLEGAMENTI[col].etichetta;
  return maiuscolaIniziale(umanizza(col));
}

function valoreCodificato(tabella: string, col: string, v: string): string {
  if (col === "responsabile" || col === "funzione") return FUNZIONE_LABELS[v as Funzione] ?? v;
  if (tabella === "gal_agenda_pratiche" && col === "categoria") return categoriaLabel(v);
  if (tabella === "gal_movimenti_cassa" && col === "categoria") return categoriaMovimentoLabel(v);
  if (tabella === "gal_scadenze_pagamento" && col === "tipo") return TIPO_SCADENZA_LABELS[v as TipoScadenzaPagamento] ?? v;
  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(v)) return v;
  return maiuscolaIniziale(umanizza(v));
}

/** Carica tutte le righe di una tabella a blocchi da 1000 */
async function caricaTabella(tabella: string): Promise<Riga[]> {
  const out: Riga[] = [];
  for (let da = 0; ; da += 1000) {
    const { data, error } = await supabase.from(tabella).select("*").range(da, da + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Riga[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function costruisciFoglio(sez: SezioneExport, righe: Riga[], dati: Map<string, Riga[]>, mostraGal: boolean): FoglioExcel {
  // Colonne nell'ordine del database (unione delle chiavi presenti)
  const chiavi: string[] = [];
  for (const r of righe) for (const k of Object.keys(r)) if (!chiavi.includes(k)) chiavi.push(k);
  const colonneDb = chiavi.filter((c) => {
    if (ESCLUSE.has(c) || c.endsWith("_path")) return false;
    if (c === "created_at" && !sez.conDataCreazione) return false;
    if (c === "gal_id" && !mostraGal) return false;
    if (sez.tabella === "gal_gal" && c === "gal_id") return false;
    return true;
  });
  if (mostraGal && colonneDb.includes("gal_id")) {
    colonneDb.splice(colonneDb.indexOf("gal_id"), 1);
    colonneDb.unshift("gal_id");
  }

  // Indici dei record collegati
  const indici = new Map<string, Map<string, string>>();
  for (const c of colonneDb) {
    const coll = COLLEGAMENTI[c];
    if (!coll || indici.has(c)) continue;
    const m = new Map<string, string>();
    for (const r of dati.get(coll.tabella) ?? []) m.set(String(r.id), coll.testo(r));
    indici.set(c, m);
  }

  // Formato di ogni colonna dedotto dai valori
  const formati: FormatoColonna[] = colonneDb.map((c) => {
    if (COLLEGAMENTI[c]) return "testo";
    let fmt: FormatoColonna | null = null;
    for (const r of righe) {
      const v = r[c];
      if (v === null || v === undefined || v === "") continue;
      if (typeof v === "number") {
        const interi = righe.every((x) => typeof x[c] !== "number" || Number.isInteger(x[c]));
        fmt = EURO.test(c) ? "euro" : interi ? "intero" : "numero";
        break;
      }
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) { fmt = "data"; break; }
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) { fmt = "dataora"; break; }
      fmt = "testo";
      break;
    }
    return fmt ?? (EURO.test(c) ? "euro" : "testo");
  });

  const colonne: ColonnaExcel[] = colonneDb.map((c, i) => ({ titolo: intestazione(c), formato: formati[i] }));
  const valori: ValoreCella[][] = righe.map((r) =>
    colonneDb.map((c, i) => {
      const v = r[c];
      if (v === null || v === undefined || v === "") return null;
      const idx = indici.get(c);
      if (idx) return idx.get(String(v)) ?? String(v);
      if (formati[i] === "data" || formati[i] === "dataora") return typeof v === "string" ? dataDaIso(v) ?? v : null;
      if (typeof v === "boolean") return v ? "Sì" : "No";
      if (typeof v === "number") return v;
      if (typeof v === "object") return JSON.stringify(v);
      const s = String(v);
      return CAMPI_CODIFICATI.has(c) ? valoreCodificato(sez.tabella, c, s) : s;
    })
  );

  return {
    nome: sez.foglio,
    titolo: sez.foglio,
    sottotitolo: `${sez.gruppo} — ${righe.length} record`,
    gruppo: sez.gruppo,
    colonne: colonne.length ? colonne : [{ titolo: "Nessun dato", formato: "testo" }],
    righe: colonne.length ? valori : [],
  };
}

export interface OpzioniEsportazione {
  tabelle: string[];          // sezioni da includere
  galId: string | null;       // null = tutti i GAL dell'installazione
  galNome: string;
  onProgress?: (perc: number, testo: string) => void;
}

/** Ordina le righe in modo leggibile (date di scadenza, numeri, nomi) */
function ordina(tabella: string, righe: Riga[]): Riga[] {
  const chiave: Record<string, string> = {
    gal_agenda_pratiche: "data_scadenza", gal_agenda_checklist: "pratica_id", gal_agenda_note: "created_at",
    gal_scadenze_pagamento: "data_scadenza", gal_movimenti_cassa: "data_prevista", gal_fascicoli: "numero_fascicolo",
    gal_giustificativi: "data_doc", gal_audit: "created_at", gal_soci: "denominazione", gal_fornitori: "denominazione",
    gal_contratti: "data_stipula", gal_sedute: "data_seduta",
  };
  const k = chiave[tabella];
  if (!k) return righe;
  return [...righe].sort((a, b) => String(a[k] ?? "").localeCompare(String(b[k] ?? ""), "it", { numeric: true }));
}

export async function esportaDatabaseExcel(opt: OpzioniEsportazione): Promise<{ blob: Blob; record: number; fogli: number }> {
  const sezioni = SEZIONI_EXPORT.filter((s) => opt.tabelle.includes(s.tabella));
  // Servono anche le tabelle collegate, per scrivere i nomi al posto dei codici
  const daCaricare = new Set<string>(sezioni.map((s) => s.tabella));
  Object.values(COLLEGAMENTI).forEach((c) => daCaricare.add(c.tabella));

  const dati = new Map<string, Riga[]>();
  const elenco = [...daCaricare];
  for (let i = 0; i < elenco.length; i++) {
    opt.onProgress?.(Math.round((i / elenco.length) * 80), `Lettura ${SEZIONI_EXPORT.find((s) => s.tabella === elenco[i])?.foglio ?? elenco[i]}…`);
    try {
      dati.set(elenco[i], await caricaTabella(elenco[i]));
    } catch (e) {
      console.error(elenco[i], e);
      dati.set(elenco[i], []);
    }
  }

  // Filtro per GAL (le imputazioni non hanno gal_id: si filtrano tramite il giustificativo)
  const filtra = (tabella: string, righe: Riga[]): Riga[] => {
    if (!opt.galId) return righe;
    if (tabella === "gal_gal") return righe.filter((r) => r.id === opt.galId);
    if (tabella === "gal_righe_imputazione") {
      const ids = new Set((dati.get("gal_giustificativi") ?? []).filter((g) => g.gal_id === opt.galId).map((g) => g.id));
      return righe.filter((r) => ids.has(r.giustificativo_id));
    }
    return righe.filter((r) => !("gal_id" in r) || r.gal_id === opt.galId || (tabella === "gal_profili" && r.gal_id === null));
  };

  opt.onProgress?.(85, "Creazione delle tabelle Excel…");
  const fogli = sezioni.map((s) => costruisciFoglio(s, ordina(s.tabella, filtra(s.tabella, dati.get(s.tabella) ?? [])), dati, !opt.galId));
  const record = fogli.reduce((t, f) => t + f.righe.length, 0);
  const ora = new Date();
  const blob = await creaFileExcel({
    titolo: `Archivio dati — ${opt.galNome}`,
    sottotitolo: `Esportato il ${ora.toLocaleDateString("it-IT")} alle ${ora.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} — ${fogli.length} sezioni, ${record} record`,
    fogli,
  });
  opt.onProgress?.(100, "Completato");
  return { blob, record, fogli: fogli.length };
}
