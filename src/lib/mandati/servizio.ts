// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Collegamento tra il codice collaudato del kit (fatturaPA, controlli, generaMandato)
 * e i dati del gestionale: impostazioni, logo, scadenzario, giustificativi, Storage.
 * Il mandato si genera solo in Word, nel browser: nessun servizio esterno.
 */
import { supabase } from "../supabase";
import { BUCKET_DOCUMENTI } from "../../constants";
import { r2 } from "./importoInLettere";
import { controllaScheda } from "./controlli";
import { fatturaPAtoSchede, testoXmlFattura } from "./fatturaPA";
import { generaMandatoDocx } from "./generaMandato";
import type { Ente, SchedaMandato, VoceMandato } from "./tipi";
import type { Gal, Giustificativo, ImpostazioniMandati, Mandato, ScadenzaPagamento, StatoMandato } from "../../types";

export const STATO_MANDATO_LABELS: Record<StatoMandato, string> = {
  bozza: "Bozza",
  verificato: "Verificato",
  firmato: "Firmato",
  pagato: "Pagato",
  annullato: "Annullato",
};

export const STATO_MANDATO_COLORS: Record<StatoMandato, string> = {
  bozza: "bg-yellow-100 text-yellow-800",
  verificato: "bg-blue-100 text-blue-800",
  firmato: "bg-indigo-100 text-indigo-800",
  pagato: "bg-green-100 text-green-800",
  annullato: "bg-gray-200 text-gray-700",
};

export const PERCORSO_MODELLO = "/modelli/modello_mandato.docx";
export const PERCORSO_LOGO = "impostazioni/logo_mandati.png";

export const numeroStampa = (m: Pick<Mandato, "numero" | "anno">) => `${m.numero}/${m.anno}`;
const dataIt = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export async function caricaImpostazioni(): Promise<ImpostazioniMandati | null> {
  const { data, error } = await supabase.from("gal_mandati_impostazioni").select("*").limit(1).maybeSingle();
  if (error) throw error;
  return (data ?? null) as ImpostazioniMandati | null;
}

/** Dati dell'intestazione: anagrafica del GAL + impostazioni dei mandati + logo PNG */
export async function caricaEnte(gal: Gal, imp: ImpostazioniMandati | null): Promise<Ente> {
  let logo: Uint8Array | undefined;
  if (imp?.logo_path) {
    const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTI).download(imp.logo_path);
    if (error) console.error("Logo non scaricato: resta quello del modello", error);
    else logo = new Uint8Array(await data.arrayBuffer());
  }
  return {
    nome: gal.nome,
    indirizzo: gal.indirizzo ?? "",
    cf: gal.codice_fiscale ?? "",
    pec: gal.pec ?? "",
    iban_addebito: imp?.iban_addebito ?? "",
    banca_tesoriere: imp?.banca_tesoriere ?? "",
    pratica: imp?.pratica ?? "",
    firma_sinistra: imp?.firma_sinistra ?? "",
    firma_destra: imp?.firma_destra ?? "",
    logo_png: logo,
  };
}

/** Controlla che il file sia davvero un PNG (il modello accetta solo PNG) */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

let modelloInCache: Uint8Array | null = null;
async function modello(): Promise<Uint8Array> {
  if (modelloInCache) return modelloInCache;
  const r = await fetch(PERCORSO_MODELLO);
  if (!r.ok) throw new Error("Modello Word del mandato non trovato");
  modelloInCache = new Uint8Array(await r.arrayBuffer());
  return modelloInCache;
}

/** Word del mandato. In bozza il piè di pagina riporta "BOZZA - da verificare…". */
export async function generaWord(m: Pick<Mandato, "scheda" | "numero" | "anno" | "data_ordine" | "stato">, ente: Ente): Promise<Blob> {
  const bytes = generaMandatoDocx(await modello(), m.scheda, ente, {
    numero_ordine: numeroStampa(m),
    data_ordine: dataIt(m.data_ordine),
    bozza: m.stato === "bozza",
  });
  return new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export function nomeFileMandato(m: Pick<Mandato, "numero" | "anno" | "beneficiario_nome" | "stato">): string {
  const benef = m.beneficiario_nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  return `Mandato_${m.numero}_${m.anno}_${benef}${m.stato === "bozza" ? "_BOZZA" : ""}.docx`;
}

export function scaricaFile(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Valori di progetto presi dalle impostazioni quando la scheda non li ha */
export function applicaImpostazioni(s: SchedaMandato, imp: ImpostazioniMandati | null): SchedaMandato {
  return {
    ...s,
    operazione: s.operazione || imp?.operazione || undefined,
    misura: s.misura || imp?.misura || undefined,
    cup: s.cup || imp?.cup || undefined,
  };
}

export function schedaVuota(imp: ImpostazioniMandati | null): SchedaMandato {
  return applicaImpostazioni({
    tipo_documento: "altro", beneficiario_nome: "", modalita: "bonifico",
    titolo_importi: "Importi da pagare", voci: [], netto: 0, causale: "", note: [],
  }, imp);
}

/** Voci standard da importi già registrati (scadenzario o giustificativo) */
function vociDaImporti(i: { imponibile: number; iva: number; totale: number; ritenuta: number; split: boolean; codiceRitenuta?: string | null }): VoceMandato[] {
  const voci: VoceMandato[] = [];
  if (i.imponibile) voci.push({ voce: "Imponibile", importo: r2(i.imponibile) });
  if (i.iva) voci.push({ voce: i.split ? "IVA (scissione dei pagamenti)" : "IVA", importo: r2(i.iva) });
  voci.push({ voce: "Totale documento", importo: r2(i.totale), grassetto: true });
  if (i.ritenuta) voci.push({ voce: `Ritenuta d'acconto${i.codiceRitenuta ? ` - cod. tributo ${i.codiceRitenuta}` : ""} (da versare con F24)`, importo: -r2(i.ritenuta) });
  if (i.split && i.iva) voci.push({ voce: "IVA in scissione dei pagamenti (da versare con F24)", importo: -r2(i.iva) });
  return voci;
}

function causaleDocumento(descr: string, numero?: string | null, data?: string | null, cup?: string | null): string {
  const doc = numero ? `Fattura n. ${numero}${data ? ` del ${dataIt(data)}` : ""} - ` : "";
  return `${doc}${descr}${cup ? ` - CUP ${cup}` : ""}`;
}

/** Scheda dai dati della riga di scadenzario (quando non c'è una fattura XML da leggere) */
export function schedaDaScadenza(sc: ScadenzaPagamento, imp: ImpostazioniMandati | null): SchedaMandato {
  const f24 = sc.tipo === "f24";
  const note: string[] = [];
  if (sc.verifica_note) note.push(sc.verifica_note);
  return applicaImpostazioni({
    tipo_documento: f24 ? "f24" : "altro",
    beneficiario_nome: sc.beneficiario,
    beneficiario_cf: sc.beneficiario_cf ?? undefined,
    beneficiario_piva: sc.beneficiario_piva ?? undefined,
    beneficiario_iban: sc.beneficiario_iban ?? undefined,
    modalita: f24 ? "f24" : "bonifico",
    numero_documento: sc.numero_documento ?? undefined,
    data_documento: sc.data_documento ?? undefined,
    titolo_importi: f24 ? "Importi da versare" : "Importi da fattura",
    voci: vociDaImporti({ imponibile: sc.imponibile, iva: sc.iva, totale: sc.totale_documento, ritenuta: sc.ritenuta, split: sc.split_payment, codiceRitenuta: sc.ritenuta_codice_tributo }),
    totale_documento: sc.totale_documento,
    ritenute: sc.ritenuta,
    netto: r2(sc.importo_da_pagare),
    causale: causaleDocumento(sc.descrizione, sc.numero_documento, sc.data_documento, sc.cup),
    cup: sc.cup || undefined,
    cig: sc.cig ?? undefined,
    note,
  }, imp);
}

/** Scheda dai dati del giustificativo (rendicontazione) quando non c'è una fattura XML */
export function schedaDaGiustificativo(g: Giustificativo, imp: ImpostazioniMandati | null): SchedaMandato {
  return applicaImpostazioni({
    tipo_documento: "altro",
    beneficiario_nome: g.fornitore_denominazione ?? g.fornitore?.denominazione ?? "",
    beneficiario_piva: g.fornitore_piva ?? undefined,
    modalita: "bonifico",
    numero_documento: g.numero_doc,
    data_documento: g.data_doc,
    titolo_importi: "Importi da fattura",
    voci: vociDaImporti({ imponibile: g.imponibile, iva: g.iva, totale: g.totale, ritenuta: 0, split: false }),
    totale_documento: g.totale,
    netto: r2(g.totale),
    causale: causaleDocumento(g.note || g.tipologia_spesa || "Pagamento fattura", g.numero_doc, g.data_doc, g.cup),
    cup: g.cup ?? undefined,
    cig: g.cig ?? undefined,
    note: ["Dati presi dal giustificativo: verificare ritenute, split payment e IBAN sulla fattura."],
  }, imp);
}

export const isFileFattura = (nome?: string | null) => !!nome && /\.xml(\.p7m)?$|\.p7m$/i.test(nome);

/** Schede da un file di fattura elettronica (XML o .xml.p7m); una per ogni corpo della fattura */
export function schedeDaFileFattura(bytes: Uint8Array, imp: ImpostazioniMandati | null): SchedaMandato[] {
  return fatturaPAtoSchede(testoXmlFattura(bytes), imp?.cup ?? undefined).map((s) => applicaImpostazioni(s, imp));
}

export async function scaricaDaArchivio(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTI).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

/** Note "DA VERIFICARE" dei controlli: quelle del kit più l'esercizio precedente */
export function noteControlli(s: SchedaMandato, dataOrdine: string): string[] {
  const out = controllaScheda(s);
  if (s.data_documento && s.data_documento.slice(0, 4) < dataOrdine.slice(0, 4)) {
    out.push(`Documento dell'esercizio ${s.data_documento.slice(0, 4)}: verificare che non sia già stato pagato o rendicontato.`);
  }
  return out;
}

/** Aggiunge le note dei controlli senza ripetere quelle già presenti */
export function uniscinote(s: SchedaMandato, dataOrdine: string): SchedaMandato {
  const note = [...s.note];
  for (const n of noteControlli(s, dataOrdine)) if (!note.includes(n)) note.push(n);
  return { ...s, note };
}

/** Somma delle voci "normali" (le righe in grassetto sono totali) */
export const sommaVoci = (voci: VoceMandato[]) => r2(voci.filter((v) => !v.grassetto).reduce((a, v) => a + (Number(v.importo) || 0), 0));

/** Mandati non annullati già emessi per lo stesso documento (per evitare doppi pagamenti) */
export async function mandatiGiaEmessi(c: { scadenzaId?: string | null; giustificativoId?: string | null; piva?: string; numeroDocumento?: string; escludiId?: string }): Promise<Pick<Mandato, "id" | "numero" | "anno" | "stato" | "beneficiario_nome">[]> {
  const filtri: string[] = [];
  if (c.scadenzaId) filtri.push(`scadenza_id.eq.${c.scadenzaId}`);
  if (c.giustificativoId) filtri.push(`giustificativo_id.eq.${c.giustificativoId}`);
  if (c.piva && c.numeroDocumento) {
    const v = (x: string) => `"${x.replace(/"/g, '\\"')}"`;
    filtri.push(`and(beneficiario_piva.eq.${v(c.piva)},numero_documento.eq.${v(c.numeroDocumento)})`);
  }
  if (!filtri.length) return [];
  let q = supabase.from("gal_mandati").select("id, numero, anno, stato, beneficiario_nome").neq("stato", "annullato").or(filtri.join(","));
  if (c.escludiId) q = q.neq("id", c.escludiId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Pick<Mandato, "id" | "numero" | "anno" | "stato" | "beneficiario_nome">[];
}

// ─── Conferma, archivio e generazione in blocco ──────────────────

/**
 * Conferma (verificato): genera il Word senza "BOZZA", lo archivia e lo collega al giustificativo.
 * Va chiamata solo dopo la conferma esplicita dell'utente.
 */
export async function archiviaEVerifica(m: Mandato, ente: Ente, nomeUtente: string): Promise<{ mandato: Mandato; word: Blob; avviso?: string }> {
  const verificato: Mandato = { ...m, stato: "verificato" };
  const word = await generaWord(verificato, ente);
  const path = `mandati/${m.anno}/${nomeFileMandato(verificato)}`;
  const up = await supabase.storage.from(BUCKET_DOCUMENTI).upload(path, word, { upsert: true, contentType: word.type });
  if (up.error) throw up.error;
  const { data, error } = await supabase.from("gal_mandati")
    .update({ stato: "verificato", docx_path: path, verificato_da: nomeUtente, verificato_il: new Date().toISOString() })
    .eq("id", m.id).select("*").single();
  if (error || !data) throw error ?? new Error("Mandato non aggiornato");
  let avviso: string | undefined;
  if (m.giustificativo_id) {
    // Il Word va tra i documenti del giustificativo (rendicontazione), una sola volta
    const { data: gia, error: errDoc } = await supabase.from("gal_documenti_giustificativo").select("id")
      .eq("giustificativo_id", m.giustificativo_id).eq("storage_path", path).limit(1);
    const { error: errIns } = errDoc || gia?.length ? { error: errDoc } : await supabase.from("gal_documenti_giustificativo").insert({
      gal_id: m.gal_id, giustificativo_id: m.giustificativo_id, tipo: "mandato_pagamento",
      nome_file: nomeFileMandato(verificato), storage_path: path, dimensione: word.size, note: `Mandato n. ${numeroStampa(m)}`,
    });
    if (errIns) avviso = "Mandato verificato, ma non collegato ai documenti del giustificativo";
  }
  return { mandato: data as Mandato, word, avviso };
}

/** Un unico file ZIP con il Word di ogni mandato (avanzamento: fatti, totale) */
export async function zipWord(mandati: Mandato[], ente: Ente, avanzamento?: (fatti: number, totale: number) => void): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (let i = 0; i < mandati.length; i++) {
    zip.file(nomeFileMandato(mandati[i]), await generaWord(mandati[i], ente));
    avanzamento?.(i + 1, mandati.length);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

// ─── Compensi (gettoni CdA, commissioni, revisori) ───────────────

/** Documenti che il fascicolo deve contenere per pagare un compenso (Circ. Min. Lavoro 2/2009) */
export const NOTA_ALLEGATI_COMPENSO =
  "Verificare nel fascicolo: atto di nomina/incarico, delibera che fissa il compenso, verbali o fogli presenza delle sedute (Circ. Min. Lavoro n. 2/2009).";

/** CF e IBAN dell'ultimo mandato di compenso intestato alla stessa persona (per non riscriverli ogni mese) */
export async function ultimoPercettore(nome: string): Promise<{ cf?: string; iban?: string } | null> {
  const { data, error } = await supabase.from("gal_mandati").select("scheda")
    .eq("tipo_documento", "distinta_compenso").ilike("beneficiario_nome", nome.trim())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) { console.error(error); return null; }
  const s = (data as { scheda: SchedaMandato } | null)?.scheda;
  return s ? { cf: s.beneficiario_cf, iban: s.beneficiario_iban } : null;
}

/** Mandati di compenso non annullati già emessi alla stessa persona per lo stesso periodo */
export async function compensiGiaEmessi(nome: string, periodo: string): Promise<Pick<Mandato, "id" | "numero" | "anno">[]> {
  const { data, error } = await supabase.from("gal_mandati").select("id, numero, anno")
    .eq("tipo_documento", "distinta_compenso").neq("stato", "annullato")
    .ilike("beneficiario_nome", nome.trim()).ilike("scheda->>causale", `%competenza ${periodo.trim()}%`);
  if (error) { console.error(error); return []; }
  return (data ?? []) as Pick<Mandato, "id" | "numero" | "anno">[];
}
