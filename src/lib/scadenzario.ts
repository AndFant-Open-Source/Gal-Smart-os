// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Scadenzario pagamenti — operazioni su Supabase e scheda mandato PDF (GAL-OS 4.0)
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "./supabase";
import { pdfDate, pdfEur } from "./pdf";
import { scadenzaF24 } from "./scadenze";
import {
  MODALITA_PAGAMENTO_LABELS, TIPO_SCADENZA_LABELS, TIPO_CONTO_LABELS,
} from "../constants";
import type { ContoCorrente, Gal, ScadenzaPagamento } from "../types";

const BENEFICIARIO_ERARIO = "Erario — Agenzia delle Entrate (F24)";
const MOTIVO_CIG_F24 = "Pagamento di tributi, imposte, contributi (F24)";

interface F24DaCreare {
  chiave: "ritenuta" | "split";
  descrizione: string;
  importo: number;
  codice: string | null;
}

/**
 * Crea (o aggiorna) le scadenze F24 collegate al pagamento:
 * - ritenuta d'acconto trattenuta al beneficiario
 * - IVA in split payment da versare all'Erario (cod. 620E)
 * Scadenza: 16 del mese successivo alla data di pagamento.
 * Restituisce il numero di F24 creati/aggiornati.
 */
export async function generaF24Collegati(s: ScadenzaPagamento, dataPagamento: string): Promise<number> {
  const daCreare: F24DaCreare[] = [];
  const rif = `${TIPO_SCADENZA_LABELS[s.tipo]}${s.numero_documento ? ` n. ${s.numero_documento}` : ""}${s.data_documento ? ` del ${pdfDate(s.data_documento)}` : ""} — ${s.beneficiario}`;
  if (s.ritenuta > 0) {
    daCreare.push({
      chiave: "ritenuta",
      descrizione: `Versamento ritenuta d'acconto${s.ritenuta_codice_tributo && s.ritenuta_codice_tributo !== "altro" ? ` (cod. ${s.ritenuta_codice_tributo})` : ""} — ${rif}`,
      importo: s.ritenuta,
      codice: s.ritenuta_codice_tributo,
    });
  }
  if (s.split_payment && s.iva > 0) {
    daCreare.push({
      chiave: "split",
      descrizione: `Versamento IVA split payment (cod. 620E) — ${rif}`,
      importo: s.iva,
      codice: "620E",
    });
  }
  if (!daCreare.length) return 0;

  const { data: esistenti, error } = await supabase
    .from("gal_scadenze_pagamento")
    .select("id, descrizione, stato")
    .eq("scadenza_origine_id", s.id)
    .eq("tipo", "f24");
  if (error) throw error;

  const scad = scadenzaF24(dataPagamento);
  let n = 0;
  for (const f of daCreare) {
    const prefisso = f.chiave === "ritenuta" ? "Versamento ritenuta" : "Versamento IVA split";
    const gia = (esistenti ?? []).find((e) => (e.descrizione as string).startsWith(prefisso));
    const record = {
      gal_id: s.gal_id,
      tipo: "f24",
      beneficiario: BENEFICIARIO_ERARIO,
      descrizione: f.descrizione,
      imponibile: f.importo,
      iva: 0,
      totale_documento: f.importo,
      importo_da_pagare: f.importo,
      ritenuta: 0,
      ritenuta_codice_tributo: f.codice,
      cup: s.cup,
      cup_in_fattura: false,
      cig_esente: true,
      cig_motivo_esenzione: MOTIVO_CIG_F24,
      intervento: s.intervento,
      capitolo: s.capitolo,
      data_scadenza: scad,
      modalita_pagamento: "f24",
      conto_id: s.conto_id,
      scadenza_origine_id: s.id,
    };
    if (gia) {
      if (gia.stato === "pagata") continue; // non toccare F24 già versati
      const { error: uErr } = await supabase.from("gal_scadenze_pagamento").update(record).eq("id", gia.id);
      if (uErr) throw uErr;
    } else {
      const { error: iErr } = await supabase.from("gal_scadenze_pagamento").insert({ ...record, stato: "da_pagare" });
      if (iErr) throw iErr;
    }
    n++;
  }
  return n;
}

/** Carica un file nel bucket privato e restituisce il path */
export async function caricaAllegato(galId: string, scadenzaId: string, tipo: "fattura" | "bonifico", file: File): Promise<string> {
  const pulito = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `scadenzario/${galId}/${scadenzaId}/${tipo}_${Date.now()}_${pulito}`;
  const { error } = await supabase.storage.from("documenti_gal").upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

export async function apriAllegato(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from("documenti_gal").createSignedUrl(path, 3600);
  if (error || !data) throw error ?? new Error("URL non disponibile");
  window.open(data.signedUrl, "_blank", "noopener");
}

/**
 * Propone il prossimo numero di mandato dell'anno (es. "12/2026"): lo stesso della
 * numerazione automatica dei Mandati di pagamento, che considera anche i numeri
 * già scritti nello scadenzario.
 */
export async function prossimoNumeroMandato(galId: string, anno: number): Promise<string> {
  const proposto = await supabase.rpc("gal_mandati_numero_proposto", { p_anno: anno });
  if (!proposto.error && typeof proposto.data === "number") return `${proposto.data}/${anno}`;
  // Database non ancora aggiornato con il modulo mandati: calcolo dai soli numeri dello scadenzario
  const { data, error } = await supabase
    .from("gal_scadenze_pagamento")
    .select("mandato_numero")
    .eq("gal_id", galId)
    .like("mandato_numero", `%/${anno}`);
  if (error) throw error;
  const max = (data ?? []).reduce((m, r) => {
    const n = parseInt(String(r.mandato_numero).split("/")[0], 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${max + 1}/${anno}`;
}

// ─── Scheda mandato PDF ─────────────────────────────────────────

type AutoTableDoc = jsPDF & { lastAutoTable: { finalY: number } };

const VERDE: [number, number, number] = [22, 101, 52];

function sezione(doc: AutoTableDoc, titolo: string, righe: [string, string][], startY: number): number {
  autoTable(doc, {
    startY,
    head: [[{ content: titolo, colSpan: 2 }]],
    body: righe,
    theme: "grid",
    pageBreak: "avoid",
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold", fontSize: 8.5, cellPadding: 1.4 },
    bodyStyles: { fontSize: 8, textColor: [30, 30, 30], cellPadding: 1.2 },
    columnStyles: { 0: { cellWidth: 62, fontStyle: "bold", fillColor: [243, 244, 246] }, 1: { cellWidth: "auto" } },
    margin: { left: 12, right: 12 },
  });
  return doc.lastAutoTable.finalY + 3;
}

function siNo(v: boolean): string {
  return v ? "SÌ" : "NO";
}

export function generaSchedaMandato(params: {
  scadenza: ScadenzaPagamento;
  conto: ContoCorrente | null;
  gal: Gal | null;
  f24Collegati: Pick<ScadenzaPagamento, "descrizione" | "importo_da_pagare" | "data_scadenza" | "stato">[];
}): void {
  const { scadenza: s, conto, gal, f24Collegati } = params;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" }) as AutoTableDoc;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Intestazione
  doc.setFillColor(...VERDE);
  doc.rect(0, 0, pageW, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(gal?.nome ?? "GAL", 12, 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const sottoIntestazione = [gal?.indirizzo, gal?.codice_fiscale ? `C.F. ${gal.codice_fiscale}` : null, gal?.partita_iva ? `P.IVA ${gal.partita_iva}` : null]
    .filter(Boolean).join(" — ");
  if (sottoIntestazione) doc.text(sottoIntestazione, 12, 15);

  doc.setTextColor(...VERDE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("SCHEDA PER L'EMISSIONE DEL MANDATO DI PAGAMENTO", pageW / 2, 32, { align: "center" });
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(
    `Mandato n. ${s.mandato_numero || "________"}   del ${s.mandato_data ? pdfDate(s.mandato_data) : "____/____/________"}`,
    pageW / 2, 39, { align: "center" }
  );

  let y = 45;
  y = sezione(doc, "1. BENEFICIARIO", [
    ["Denominazione", s.beneficiario],
    ["Partita IVA", s.beneficiario_piva || "—"],
    ["Codice fiscale", s.beneficiario_cf || "—"],
    ["IBAN beneficiario", s.beneficiario_iban || "—"],
  ], y);

  y = sezione(doc, "2. DOCUMENTO DI SPESA", [
    ["Tipologia", TIPO_SCADENZA_LABELS[s.tipo]],
    ["Numero / data", `${s.numero_documento || "—"}  del  ${pdfDate(s.data_documento)}`],
    ["Oggetto / causale", s.descrizione],
    ["Intervento / capitolo", [s.intervento, s.capitolo].filter(Boolean).join(" — ") || "—"],
    ["Scadenza di pagamento", pdfDate(s.data_scadenza)],
  ], y);

  const importi: [string, string][] = [
    ["Imponibile", pdfEur(s.imponibile)],
    ["IVA", pdfEur(s.iva)],
    ["Totale documento", pdfEur(s.totale_documento)],
  ];
  if (s.split_payment) importi.push(["IVA in split payment (art. 17-ter DPR 633/72)", `- ${pdfEur(s.iva)}  (versata all'Erario con F24)`]);
  if (s.ritenuta > 0) importi.push([`Ritenuta d'acconto${s.ritenuta_codice_tributo ? ` (cod. ${s.ritenuta_codice_tributo})` : ""}`, `- ${pdfEur(s.ritenuta)}  (versata con F24)`]);
  importi.push(["NETTO DA PAGARE AL BENEFICIARIO", pdfEur(s.importo_da_pagare)]);
  y = sezione(doc, "3. IMPORTI", importi, y);

  y = sezione(doc, "4. TRACCIABILITÀ (L. 136/2010) E VERIFICHE", [
    ["CUP", s.cup],
    ["CUP riportato in fattura", siNo(s.cup_in_fattura)],
    ["CIG", s.cig_esente ? `Non dovuto — ${s.cig_motivo_esenzione || "motivazione non indicata"}` : s.cig || "—"],
    ...(s.cig_esente ? [] : [["CIG riportato in fattura", siNo(s.cig_in_fattura)] as [string, string]]),
    ...(s.verifica_note ? [["Note di verifica", s.verifica_note] as [string, string]] : []),
  ], y);

  y = sezione(doc, "5. ESTREMI DEL PAGAMENTO", [
    ["Data pagamento", pdfDate(s.data_pagamento)],
    ["Modalità", s.modalita_pagamento ? MODALITA_PAGAMENTO_LABELS[s.modalita_pagamento] : "—"],
    ["Conto di addebito", conto ? `${conto.nome}${conto.banca ? ` — ${conto.banca}` : ""} (${TIPO_CONTO_LABELS[conto.tipo]})` : "—"],
    ["IBAN conto di addebito", conto?.iban || "—"],
    ["CRO / TRN", s.cro_trn || "—"],
    ["Importo pagato", pdfEur(s.importo_pagato ?? s.importo_da_pagare)],
  ], y);

  if (f24Collegati.length) {
    autoTable(doc, {
      startY: y,
      head: [["6. ADEMPIMENTI F24 COLLEGATI", "Scadenza", "Importo", "Stato"]],
      body: f24Collegati.map((f) => [f.descrizione, pdfDate(f.data_scadenza), pdfEur(f.importo_da_pagare), f.stato === "pagata" ? "Versato" : "Da versare"]),
      theme: "grid",
      pageBreak: "avoid",
      headStyles: { fillColor: VERDE, textColor: 255, fontStyle: "bold", fontSize: 8.5, cellPadding: 1.4 },
      bodyStyles: { fontSize: 7.5, cellPadding: 1.2 },
      columnStyles: { 1: { cellWidth: 24 }, 2: { cellWidth: 26, halign: "right" }, 3: { cellWidth: 22 } },
      margin: { left: 12, right: 12 },
    });
    y = doc.lastAutoTable.finalY + 3;
  }

  y = sezione(doc, `${f24Collegati.length ? "7" : "6"}. DOCUMENTAZIONE ALLEGATA`, [
    ["Fattura / documento", s.fattura_nome || "—"],
    ["Contabile di pagamento", s.bonifico_nome || "—"],
  ], y);

  // Controlli preliminari da spuntare a mano
  if (y > pageH - 62) { doc.addPage(); y = 20; }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...VERDE);
  doc.text("CONTROLLI PRELIMINARI", 12, y + 3);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(8.5);
  const controlli = [
    "Regolare esecuzione della prestazione / fornitura attestata",
    "DURC regolare in corso di validità",
    "Verifica inadempimenti Agenzia Entrate-Riscossione (art. 48-bis DPR 602/73, se > € 5.000)",
    "Conto corrente dedicato comunicato dal beneficiario (art. 3 L. 136/2010)",
    "Spesa coerente con il piano finanziario / previsione approvata",
  ];
  controlli.forEach((c, i) => {
    const yy = y + 8 + i * 4.6;
    doc.rect(12, yy - 3, 3, 3);
    doc.text(c, 18, yy);
  });
  y += 8 + controlli.length * 4.6 + 4;

  // Firme
  if (y > pageH - 30) { doc.addPage(); y = 25; }
  const firme = ["Il Responsabile Amm.vo e Finanziario", "Il Direttore Tecnico", "Il Presidente"];
  const larg = (pageW - 24) / 3;
  doc.setFontSize(8.5);
  firme.forEach((f, i) => {
    const cx = 12 + larg * i + larg / 2;
    doc.text(f, cx, y + 4, { align: "center" });
    doc.setDrawColor(120, 120, 120);
    doc.line(cx - larg / 2 + 6, y + 18, cx + larg / 2 - 6, y + 18);
  });

  // Footer
  const pagine = doc.getNumberOfPages();
  for (let i = 1; i <= pagine; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(`Generata da GAL-OS il ${new Date().toLocaleDateString("it-IT")}`, 12, pageH - 7);
    doc.text(`Pag. ${i} di ${pagine}`, pageW - 12, pageH - 7, { align: "right" });
  }

  const nomeFile = `Scheda_mandato_${(s.mandato_numero || s.numero_documento || s.id.slice(0, 8)).replace(/[^a-zA-Z0-9]/g, "-")}_${s.beneficiario.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.pdf`;
  doc.save(nomeFile);
}
