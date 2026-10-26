// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import React, { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate } from "../../lib/utils";
import { pdfEur, pdfDate } from "../../lib/pdf";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Download, Filter, FileDown, PackageOpen } from "lucide-react";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { toast } from "sonner";
import type { Periodo, DocumentoGiustificativo } from "../../types";

interface GiustRow {
  id: string;
  numero_doc: string;
  data_doc: string;
  fornitore_denominazione: string | null;
  cig: string | null;
  imponibile: number;
  iva: number;
  totale: number;
}

interface RigaQuadro {
  id: string;
  misura: string;
  sotto_misura: string | null;
  categoria_spesa: string;
  intervento: string | null;
  tipologia_spesa: string | null;
  voce: string | null;
  capitolo: string | null;
  imponibile_imputato: number;
  iva_imputato: number;
  totale_imputato: number;
  imponibile_richiesto: number | null;
  iva_richiesta: number | null;
  totale_richiesto: number | null;
  eleggibile: boolean;
  periodo_id: string | null;
  note: string | null;
  created_at: string;
  giustificativo_id: string;
  giust: GiustRow | null;
  periodo?: { codice: string; descrizione: string } | null;
  // Calcolati
  rend_imponibile: number;
  rend_iva: number;
  rend_totale: number;
  rich_imponibile: number;
  rich_iva: number;
  rich_totale: number;
}

export default function QuadroRendicontazione() {
  const currentGal = useGalStore((s) => s.currentGal);

  const [periodi, setPeriodi] = useState<Periodo[]>([]);
  const [righe, setRighe] = useState<RigaQuadro[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const [filters, setFilters] = useState({
    periodo_id: "",
    intervento: "",
    misura: "",
    data_da: "",
    data_a: "",
    solo_eleggibili: false,
  });

  useEffect(() => {
    if (!currentGal) return;
    supabase
      .from("gal_periodi_ses")
      .select("*")
      .eq("gal_id", currentGal.id)
      .order("codice")
      .then(({ data }) => setPeriodi((data ?? []) as Periodo[]));
  }, [currentGal?.id]);

  // Codici misura dal periodi per il dropdown filtro
  const misuraCodes = (() => {
    const codes = new Set<string>();
    periodi.forEach((p) => {
      if (p.misura) codes.add(p.sotto_misura ? `${p.misura}.${p.sotto_misura}` : p.misura);
    });
    return [...codes].sort();
  })();

  async function handleSearch() {
    if (!currentGal) return;
    setLoading(true);
    try {
      // Step 1: Carica giustificativi del GAL corrente
      let gq = supabase
        .from("gal_giustificativi")
        .select("id, numero_doc, data_doc, fornitore_denominazione, cig, imponibile, iva, totale")
        .eq("gal_id", currentGal.id);
      if (filters.data_da) gq = gq.gte("data_doc", filters.data_da);
      if (filters.data_a) gq = gq.lte("data_doc", filters.data_a);
      const { data: giustData } = await gq;
      const giustList = (giustData ?? []) as GiustRow[];
      if (giustList.length === 0) { setRighe([]); setSearched(true); setLoading(false); return; }

      const giustMap = new Map(giustList.map((g) => [g.id, g]));
      const giustIds = giustList.map((g) => g.id);

      // Step 2: Carica pagamenti per calcolare rendicontata
      const { data: pagData } = await supabase
        .from("gal_pagamenti_giust")
        .select("giustificativo_id, importo")
        .in("giustificativo_id", giustIds);
      const pagMap = new Map<string, number>();
      for (const p of (pagData ?? []) as { giustificativo_id: string; importo: number }[]) {
        pagMap.set(p.giustificativo_id, (pagMap.get(p.giustificativo_id) ?? 0) + p.importo);
      }

      // Step 3: Carica righe imputazione
      let rq = supabase
        .from("gal_righe_imputazione")
        .select("*, periodo:gal_periodi_ses(codice, descrizione)")
        .in("giustificativo_id", giustIds);
      if (filters.periodo_id) rq = rq.eq("periodo_id", filters.periodo_id);
      if (filters.intervento) rq = rq.ilike("intervento", `%${filters.intervento}%`);
      if (filters.solo_eleggibili) rq = rq.eq("eleggibile", true);
      if (filters.misura) rq = rq.ilike("misura", `%${filters.misura.split(".")[0]}%`);
      const { data: righeData } = await rq.order("created_at", { ascending: false });

      // Step 4: Associa dati giustificativo e calcola rendicontata
      const righeComplete = ((righeData ?? []) as (RigaQuadro & { giustificativo_id: string })[]).map((r) => {
        const giust = giustMap.get(r.giustificativo_id) ?? null;
        const totalePagato = pagMap.get(r.giustificativo_id) ?? 0;
        const giustTotale = giust?.totale ?? 0;
        // Proporzione pagato rispetto al totale fattura
        const paymentRatio = giustTotale > 0 ? Math.min(1, totalePagato / giustTotale) : 0;

        return {
          ...r,
          giust,
          // Rendicontata: proporzione pagata applicata agli importi della riga
          rend_imponibile: Math.round(r.imponibile_imputato * paymentRatio * 100) / 100,
          rend_iva: Math.round(r.iva_imputato * paymentRatio * 100) / 100,
          rend_totale: Math.round(r.totale_imputato * paymentRatio * 100) / 100,
          // Richiesto: usa i campi specifici, fallback all'intero importo
          rich_imponibile: r.imponibile_richiesto ?? r.imponibile_imputato,
          rich_iva: r.iva_richiesta ?? r.iva_imputato,
          rich_totale: r.totale_richiesto ?? r.totale_imputato,
        };
      });

      setRighe(righeComplete);
    } catch {
      toast.error("Errore nel caricamento delle righe");
    }
    setSearched(true);
    setLoading(false);
  }

  // Ordine sequenziale per data documento
  const righeOrdinate = [...righe].sort((a, b) => {
    const da = a.giust?.data_doc ?? "";
    const db = b.giust?.data_doc ?? "";
    return da.localeCompare(db);
  });

  // Pivot: Intervento > Tipologia Spesa > righe
  const pivot: Record<string, Record<string, RigaQuadro[]>> = {};
  let orderCounter = 0;
  const orderMap = new Map<string, number>();
  for (const r of righeOrdinate) {
    orderCounter++;
    orderMap.set(r.id, orderCounter);
    const intKey = r.intervento ?? "— Senza intervento —";
    const tipKey = r.tipologia_spesa ?? r.categoria_spesa ?? "— Senza tipologia —";
    if (!pivot[intKey]) pivot[intKey] = {};
    if (!pivot[intKey][tipKey]) pivot[intKey][tipKey] = [];
    pivot[intKey][tipKey].push(r);
  }

  // Totali generali
  const totSostImp = righe.reduce((s, r) => s + r.imponibile_imputato, 0);
  const totSostIva = righe.reduce((s, r) => s + r.iva_imputato, 0);
  const totSostTot = righe.reduce((s, r) => s + r.totale_imputato, 0);
  const totRendImp = righe.reduce((s, r) => s + r.rend_imponibile, 0);
  const totRendIva = righe.reduce((s, r) => s + r.rend_iva, 0);
  const totRendTot = righe.reduce((s, r) => s + r.rend_totale, 0);
  const totRichImp = righe.reduce((s, r) => s + r.rich_imponibile, 0);
  const totRichIva = righe.reduce((s, r) => s + r.rich_iva, 0);
  const totRichTot = righe.reduce((s, r) => s + r.rich_totale, 0);

  // ── Download ZIP documenti SES con numerazione ──────────
  async function handleDownloadZip() {
    if (righeOrdinate.length === 0) { toast.error("Nessuna riga da scaricare"); return; }
    setDownloadingZip(true);
    try {
      const giustIds = [...new Set(righeOrdinate.map((r) => r.giust?.id).filter(Boolean))] as string[];
      const { data: docsData } = await supabase.from("gal_documenti_giustificativo").select("*").in("giustificativo_id", giustIds);
      const allDocs = (docsData ?? []) as DocumentoGiustificativo[];
      const docsMap: Record<string, DocumentoGiustificativo[]> = {};
      for (const d of allDocs) {
        if (!docsMap[d.giustificativo_id]) docsMap[d.giustificativo_id] = [];
        docsMap[d.giustificativo_id].push(d);
      }

      const zip = new JSZip();
      const tipiInclusi = ["fattura_cartacea", "bonifico", "f24"];
      const tipoLabel: Record<string, string> = { fattura_cartacea: "fattura", bonifico: "bonifico", f24: "f24" };

      for (const r of righeOrdinate) {
        const n = orderMap.get(r.id) ?? 0;
        const nPad = String(n).padStart(2, "0");
        const giustId = r.giust?.id;
        if (!giustId) continue;
        const docs = (docsMap[giustId] ?? []).filter((d) => tipiInclusi.includes(d.tipo));
        const fornitore = (r.giust?.fornitore_denominazione ?? "senza_fornitore").replace(/[/\\:*?"<>|]/g, "_").substring(0, 30);
        for (const doc of docs) {
          const ext = doc.nome_file.split(".").pop() ?? "pdf";
          const fileName = `${nPad}_${tipoLabel[doc.tipo] ?? doc.tipo}_${fornitore}.${ext}`;
          const { data } = await supabase.storage.from("documenti_gal").download(doc.storage_path);
          if (data) zip.file(fileName, data);
        }
      }

      const blob = await zip.generateAsync({ type: "blob" });
      if (blob.size < 100) { toast.error("Nessun documento trovato"); setDownloadingZip(false); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `rendicontazione_documenti_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Download completato");
    } catch {
      toast.error("Errore durante la preparazione dello ZIP");
    }
    setDownloadingZip(false);
  }

  function handleExport() {
    const rows = righeOrdinate.map((r) => ({
      "N.": orderMap.get(r.id) ?? "",
      "N. Documento": r.giust?.numero_doc ?? "",
      "Data": r.giust?.data_doc ? formatDate(r.giust.data_doc) : "",
      "Fornitore": r.giust?.fornitore_denominazione ?? "",
      "Capitolo": r.capitolo ?? r.categoria_spesa ?? "",
      "Misura": `${r.misura}${r.sotto_misura ? "." + r.sotto_misura : ""}`,
      "Sost. Imponibile": r.imponibile_imputato,
      "Sost. IVA": r.iva_imputato,
      "Sost. Totale": r.totale_imputato,
      "Rend. Imponibile": r.rend_imponibile,
      "Rend. IVA": r.rend_iva,
      "Rend. Totale": r.rend_totale,
      "Rich. Imponibile": r.rich_imponibile,
      "Rich. IVA": r.rich_iva,
      "Rich. Totale": r.rich_totale,
      "Eleggibile": r.eleggibile ? "Si" : "No",
      "N. Allegato": String(orderMap.get(r.id) ?? "").padStart(2, "0"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quadro");
    XLSX.writeFile(wb, `quadro_rendicontazione_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handlePdfExport() {
    if (!currentGal) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth(); // 297mm
    const pageH = doc.internal.pageSize.getHeight(); // 210mm
    const GREEN: [number, number, number] = [22, 101, 52];
    const WHITE: [number, number, number] = [255, 255, 255];
    const DARK: [number, number, number] = [30, 30, 30];
    const GRAY: [number, number, number] = [100, 100, 100];
    const STRIPE: [number, number, number] = [245, 250, 245];
    const BLUE: [number, number, number] = [30, 64, 120];

    // ── Banda intestazione verde ────────────────────────────
    doc.setFillColor(...GREEN);
    doc.rect(0, 0, pageW, 14, "F");
    doc.setTextColor(...WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(currentGal.nome ?? "GAL-OS", pageW / 2, 7, { align: "center" });
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }), pageW - 8, 10, { align: "right" });

    // ── Generalità GAL (centro) ─────────────────────────────
    let yPos = 19;
    doc.setTextColor(...DARK);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    const galInfo: string[] = [];
    if (currentGal.indirizzo) galInfo.push(`Sede: ${currentGal.indirizzo}`);
    if (currentGal.codice_fiscale) galInfo.push(`C.F.: ${currentGal.codice_fiscale}`);
    if (currentGal.partita_iva) galInfo.push(`P.IVA: ${currentGal.partita_iva}`);
    if (currentGal.pec) galInfo.push(`PEC: ${currentGal.pec}`);
    if (currentGal.email) galInfo.push(`Email: ${currentGal.email}`);
    if (currentGal.telefono) galInfo.push(`Tel: ${currentGal.telefono}`);
    if (galInfo.length > 0) {
      // Riga 1: indirizzo + CF + PIVA
      const row1 = galInfo.slice(0, 3).join("  |  ");
      doc.text(row1, pageW / 2, yPos, { align: "center" });
      yPos += 4;
      // Riga 2: PEC + email + tel
      if (galInfo.length > 3) {
        const row2 = galInfo.slice(3).join("  |  ");
        doc.text(row2, pageW / 2, yPos, { align: "center" });
        yPos += 4;
      }
    }

    // ── Titolo documento (centro) ───────────────────────────
    yPos += 2;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...BLUE);
    // Costruisci titolo: Misura filtrata + Intervento principale
    const interventoList = Object.keys(pivot);
    const misuraLabel = filters.misura || (righeOrdinate[0] ? `${righeOrdinate[0].misura}${righeOrdinate[0].sotto_misura ? "." + righeOrdinate[0].sotto_misura : ""}` : "");
    const interventoLabel = interventoList.length === 1 ? interventoList[0] : "Quadro Rendicontazione";
    const titoloPdf = misuraLabel
      ? `${misuraLabel} — Rendicontazione ${interventoLabel}`
      : `Quadro Rendicontazione — ${interventoLabel}`;
    doc.text(titoloPdf, pageW / 2, yPos, { align: "center", maxWidth: pageW - 20 });
    yPos += 5;

    // ── Sottotitolo con totali ──────────────────────────────
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(
      `${righe.length} righe — Sostenuta: ${pdfEur(totSostTot)}  |  Rendicontata: ${pdfEur(totRendTot)}  |  Richiesta: ${pdfEur(totRichTot)}`,
      pageW / 2, yPos, { align: "center" }
    );
    yPos += 5;

    // ── Separatore ──────────────────────────────────────────
    doc.setDrawColor(200, 200, 200);
    doc.line(8, yPos, pageW - 8, yPos);
    yPos += 3;

    // ── Tabella con autoTable ───────────────────────────────
    // Definisci colonne con larghezze ottimizzate per landscape A4 (277mm utili)
    const cols = [
      { header: "N.",        dataKey: "n",        },
      { header: "N. Doc",    dataKey: "ndoc",     },
      { header: "Data",      dataKey: "data",     },
      { header: "Fornitore", dataKey: "fornitore",},
      { header: "Capitolo",  dataKey: "capitolo", },
      { header: "Mis.",      dataKey: "misura",   },
      { header: "Sost.\nImp.",  dataKey: "si",  },
      { header: "Sost.\nIVA",   dataKey: "sv",  },
      { header: "Sost.\nTotale", dataKey: "st", },
      { header: "Rend.\nImp.",   dataKey: "ri", },
      { header: "Rend.\nIVA",    dataKey: "rv", },
      { header: "Rend.\nTotale", dataKey: "rt", },
      { header: "Rich.\nImp.",   dataKey: "ci", },
      { header: "Rich.\nIVA",    dataKey: "cv", },
      { header: "Rich.\nTotale", dataKey: "ct", },
      { header: "El.",      dataKey: "el",       },
      { header: "All.",     dataKey: "all",      },
    ];

    // Dati righe con raggruppamento (riga intervento + riga tipologia + righe dati)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableBody: Record<string, any>[] = [];
    for (const [intervento, tipologie] of Object.entries(pivot)) {
      const allRows = Object.values(tipologie).flat();
      const tSostTot = allRows.reduce((s, r) => s + r.totale_imputato, 0);
      const tRendTot = allRows.reduce((s, r) => s + r.rend_totale, 0);
      const tRichTot = allRows.reduce((s, r) => s + r.rich_totale, 0);
      tableBody.push({
        n: "", ndoc: "", data: "", fornitore: `INTERVENTO: ${intervento}`, capitolo: "", misura: "",
        si: "", sv: "", st: pdfEur(tSostTot),
        ri: "", rv: "", rt: pdfEur(tRendTot),
        ci: "", cv: "", ct: pdfEur(tRichTot),
        el: "", all: "", _isGroup: true,
      });
      for (const [tipologia, rows] of Object.entries(tipologie)) {
        const sTipTot = rows.reduce((s, r) => s + r.totale_imputato, 0);
        const rTipTot = rows.reduce((s, r) => s + r.rend_totale, 0);
        const cTipTot = rows.reduce((s, r) => s + r.rich_totale, 0);
        tableBody.push({
          n: "", ndoc: "", data: "", fornitore: `  ${tipologia}`, capitolo: "", misura: "",
          si: "", sv: "", st: pdfEur(sTipTot),
          ri: "", rv: "", rt: pdfEur(rTipTot),
          ci: "", cv: "", ct: pdfEur(cTipTot),
          el: "", all: "", _isSub: true,
        });
        for (const r of rows) {
          const n = orderMap.get(r.id) ?? 0;
          tableBody.push({
            n: String(n), ndoc: r.giust?.numero_doc ?? "-", data: pdfDate(r.giust?.data_doc),
            fornitore: r.giust?.fornitore_denominazione ?? "-",
            capitolo: r.capitolo ?? r.categoria_spesa ?? "",
            misura: `${r.misura}${r.sotto_misura ? "." + r.sotto_misura : ""}`,
            si: pdfEur(r.imponibile_imputato), sv: pdfEur(r.iva_imputato), st: pdfEur(r.totale_imputato),
            ri: pdfEur(r.rend_imponibile), rv: pdfEur(r.rend_iva), rt: pdfEur(r.rend_totale),
            ci: pdfEur(r.rich_imponibile), cv: pdfEur(r.rich_iva), ct: pdfEur(r.rich_totale),
            el: r.eleggibile ? "Si" : "No",
            all: String(n).padStart(2, "0"),
          });
        }
      }
    }
    // Riga totale generale
    tableBody.push({
      n: "", ndoc: "", data: "", fornitore: "TOTALE GENERALE", capitolo: "", misura: "",
      si: pdfEur(totSostImp), sv: pdfEur(totSostIva), st: pdfEur(totSostTot),
      ri: pdfEur(totRendImp), rv: pdfEur(totRendIva), rt: pdfEur(totRendTot),
      ci: pdfEur(totRichImp), cv: pdfEur(totRichIva), ct: pdfEur(totRichTot),
      el: "", all: "", _isGroup: true,
    });

    // Column styles — distribuzione ottimizzata per 277mm (landscape A4 - margini)
    const colStyles: Record<string, object> = {
      n:    { cellWidth: 8,  halign: "center" },
      ndoc: { cellWidth: 16, halign: "left" },
      data: { cellWidth: 16, halign: "center" },
      fornitore: { cellWidth: 36 },
      capitolo:  { cellWidth: 24 },
      misura:    { cellWidth: 14, halign: "center" },
      si: { cellWidth: 18, halign: "right" },
      sv: { cellWidth: 14, halign: "right" },
      st: { cellWidth: 18, halign: "right" },
      ri: { cellWidth: 18, halign: "right" },
      rv: { cellWidth: 14, halign: "right" },
      rt: { cellWidth: 18, halign: "right" },
      ci: { cellWidth: 18, halign: "right" },
      cv: { cellWidth: 14, halign: "right" },
      ct: { cellWidth: 18, halign: "right" },
      el: { cellWidth: 8,  halign: "center" },
      all:{ cellWidth: 9,  halign: "center" },
    };

    autoTable(doc, {
      startY: yPos,
      columns: cols,
      body: tableBody as Record<string, string>[],
      columnStyles: colStyles,
      headStyles: {
        fillColor: GREEN, textColor: WHITE,
        fontStyle: "bold", fontSize: 6, cellPadding: 1.5,
        valign: "middle", halign: "center",
      },
      bodyStyles: {
        fontSize: 6, textColor: DARK, cellPadding: 1.2,
      },
      alternateRowStyles: { fillColor: STRIPE },
      tableLineColor: [220, 220, 220],
      tableLineWidth: 0.1,
      margin: { left: 8, right: 8 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        if (data.section !== "body") return;
        const raw = data.row.raw;
        if (raw._isGroup) {
          data.cell.styles.fillColor = [30, 41, 59]; // slate-800
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 6.5;
        } else if (raw._isSub) {
          data.cell.styles.fillColor = [219, 234, 254]; // blue-100
          data.cell.styles.textColor = [30, 64, 120];
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fontSize = 6;
        }
      },
      didDrawPage: () => {
        // Banda verde su ogni pagina
        doc.setFillColor(...GREEN);
        doc.rect(0, 0, pageW, 14, "F");
        doc.setTextColor(...WHITE);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(currentGal.nome ?? "GAL-OS", pageW / 2, 7, { align: "center" });
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text(new Date().toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" }), pageW - 8, 10, { align: "right" });
      },
    });

    // ── Firme sull'ultima pagina ───────────────────────────
    const lastPage = doc.getNumberOfPages();
    doc.setPage(lastPage);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable?.finalY ?? (pageH - 50);
    const firmaY = Math.min(finalY + 18, pageH - 35); // spazio sotto tabella, ma non troppo in basso

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);

    // Firma RAF — sinistra
    doc.text("Il Responsabile Amministrativo e Finanziario", 30, firmaY, { align: "center" });
    doc.setDrawColor(100, 100, 100);
    doc.line(8, firmaY + 12, 52, firmaY + 12); // linea firma
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text("(RAF)", 30, firmaY + 16, { align: "center" });

    // Firma Presidente — destra
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text("Il Presidente", pageW - 30, firmaY, { align: "center" });
    doc.line(pageW - 52, firmaY + 12, pageW - 8, firmaY + 12); // linea firma
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text("(Presidente del GAL)", pageW - 30, firmaY + 16, { align: "center" });

    // ── Footer con numerazione pagine ───────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setDrawColor(200, 200, 200);
      doc.line(8, pageH - 10, pageW - 8, pageH - 10);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...GRAY);
      doc.text("Quadro Rendicontazione — uso interno", 8, pageH - 6);
      doc.text(`Pag. ${i} di ${pageCount}`, pageW - 8, pageH - 6, { align: "right" });
    }

    doc.save(`quadro_rendicontazione_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF generato");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Quadro Rendicontazione</h1>
          <p className="text-sm text-gray-500">Riepilogo spese sostenute, rendicontate e contributo richiesto</p>
        </div>
        {searched && (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={handleExport}><Download size={16} /> Excel</button>
            <button className="btn-secondary" onClick={handlePdfExport}><FileDown size={16} /> PDF</button>
            <button className="btn-primary flex items-center gap-1" onClick={handleDownloadZip} disabled={downloadingZip}>
              <PackageOpen size={16} /> {downloadingZip ? "Preparazione..." : "Scarica allegati (ZIP)"}
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-4">
        <div className="flex items-center gap-2 font-semibold text-sm text-gray-700">
          <Filter size={16} /> Filtri
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="label">Periodo SES</label>
            <select className="input" value={filters.periodo_id} onChange={(e) => setFilters({ ...filters, periodo_id: e.target.value })}>
              <option value="">Tutti</option>
              {periodi.map((p) => <option key={p.id} value={p.id}>{p.codice} — {p.descrizione}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Intervento</label>
            <input className="input" placeholder="es. Spese di progettazione" value={filters.intervento} onChange={(e) => setFilters({ ...filters, intervento: e.target.value })} />
          </div>
          <div>
            <label className="label">Misura</label>
            <select className="input" value={filters.misura} onChange={(e) => setFilters({ ...filters, misura: e.target.value })}>
              <option value="">Tutte</option>
              {misuraCodes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Data da</label>
            <input className="input" type="date" value={filters.data_da} onChange={(e) => setFilters({ ...filters, data_da: e.target.value })} />
          </div>
          <div>
            <label className="label">Data a</label>
            <input className="input" type="date" value={filters.data_a} onChange={(e) => setFilters({ ...filters, data_a: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={filters.solo_eleggibili} onChange={(e) => setFilters({ ...filters, solo_eleggibili: e.target.checked })} />
            Solo spese eleggibili
          </label>
          <button className="btn-primary" onClick={handleSearch} disabled={loading}>
            {loading ? "Caricamento..." : "Applica filtri"}
          </button>
        </div>
      </div>

      {/* KPI */}
      {searched && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-xs text-gray-500">N. Righe</p>
            <p className="text-xl font-bold">{righe.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Totale Sostenuto</p>
            <p className="text-xl font-bold">{formatCurrency(totSostTot)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Totale Rendicontato</p>
            <p className="text-xl font-bold text-blue-700">{formatCurrency(totRendTot)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Contributo Richiesto</p>
            <p className="text-xl font-bold text-green-700">{formatCurrency(totRichTot)}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {searched && (
        <div className="card overflow-hidden">
          {righe.length === 0 ? (
            <p className="p-8 text-center text-gray-400">Nessuna riga trovata con i filtri selezionati</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  {/* Header riga 1: gruppi */}
                  <tr className="bg-slate-800 text-white">
                    <th className="px-2 py-1.5 text-center" rowSpan={2}>N.</th>
                    <th className="px-2 py-1.5 text-left" rowSpan={2}>N. Doc</th>
                    <th className="px-2 py-1.5 text-left" rowSpan={2}>Data</th>
                    <th className="px-2 py-1.5 text-left" rowSpan={2}>Fornitore</th>
                    <th className="px-2 py-1.5 text-left" rowSpan={2}>Capitolo</th>
                    <th className="px-2 py-1.5 text-left" rowSpan={2}>Misura</th>
                    <th className="px-2 py-1.5 text-center border-l border-slate-600" colSpan={3}>SPESA SOSTENUTA</th>
                    <th className="px-2 py-1.5 text-center border-l border-slate-600" colSpan={3}>SPESA RENDICONTATA</th>
                    <th className="px-2 py-1.5 text-center border-l border-slate-600" colSpan={3}>CONTRIBUTO RICHIESTO</th>
                    <th className="px-2 py-1.5 text-center border-l border-slate-600" rowSpan={2}>El.</th>
                    <th className="px-2 py-1.5 text-center" rowSpan={2}>All.</th>
                  </tr>
                  {/* Header riga 2: sotto-colonne */}
                  <tr className="bg-slate-700 text-white text-xs">
                    <th className="px-2 py-1 text-right border-l border-slate-500">Imp.</th>
                    <th className="px-2 py-1 text-right">IVA</th>
                    <th className="px-2 py-1 text-right">Totale</th>
                    <th className="px-2 py-1 text-right border-l border-slate-500">Imp.</th>
                    <th className="px-2 py-1 text-right">IVA</th>
                    <th className="px-2 py-1 text-right">Totale</th>
                    <th className="px-2 py-1 text-right border-l border-slate-500">Imp.</th>
                    <th className="px-2 py-1 text-right">IVA</th>
                    <th className="px-2 py-1 text-right">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pivot).map(([intervento, tipologie]) => {
                    const allRows = Object.values(tipologie).flat();
                    const tSostImp = allRows.reduce((s, r) => s + r.imponibile_imputato, 0);
                    const tSostTot = allRows.reduce((s, r) => s + r.totale_imputato, 0);
                    const tRendTot = allRows.reduce((s, r) => s + r.rend_totale, 0);
                    const tRichTot = allRows.reduce((s, r) => s + r.rich_totale, 0);
                    return (
                      <React.Fragment key={intervento}>
                        <tr className="bg-slate-200">
                          <td className="px-2 py-1.5"></td>
                          <td colSpan={5} className="px-2 py-1.5 font-bold text-slate-700 text-xs uppercase">
                            Intervento: {intervento}
                          </td>
                          <td className="px-2 py-1.5 text-right font-bold text-slate-700 text-xs">{formatCurrency(tSostImp)}</td>
                          <td className="px-2 py-1.5"></td>
                          <td className="px-2 py-1.5 text-right font-bold text-slate-700 text-xs">{formatCurrency(tSostTot)}</td>
                          <td colSpan={2}></td>
                          <td className="px-2 py-1.5 text-right font-bold text-blue-700 text-xs">{formatCurrency(tRendTot)}</td>
                          <td colSpan={2}></td>
                          <td className="px-2 py-1.5 text-right font-bold text-green-700 text-xs">{formatCurrency(tRichTot)}</td>
                          <td colSpan={2}></td>
                        </tr>
                        {Object.entries(tipologie).map(([tipologia, rows]) => {
                          const sTipImp = rows.reduce((s, r) => s + r.imponibile_imputato, 0);
                          const sTipTot = rows.reduce((s, r) => s + r.totale_imputato, 0);
                          const rTipTot = rows.reduce((s, r) => s + r.rend_totale, 0);
                          const cTipTot = rows.reduce((s, r) => s + r.rich_totale, 0);
                          return (
                            <React.Fragment key={tipologia}>
                              <tr className="bg-blue-50 border-t border-blue-200">
                                <td className="px-2 py-1"></td>
                                <td colSpan={5} className="px-2 py-1 pl-6 font-semibold text-blue-800 text-xs uppercase">{tipologia}</td>
                                <td className="px-2 py-1 text-right font-semibold text-blue-800 text-xs">{formatCurrency(sTipImp)}</td>
                                <td className="px-2 py-1"></td>
                                <td className="px-2 py-1 text-right font-semibold text-blue-800 text-xs">{formatCurrency(sTipTot)}</td>
                                <td colSpan={2}></td>
                                <td className="px-2 py-1 text-right font-semibold text-blue-600 text-xs">{formatCurrency(rTipTot)}</td>
                                <td colSpan={2}></td>
                                <td className="px-2 py-1 text-right font-semibold text-green-700 text-xs">{formatCurrency(cTipTot)}</td>
                                <td colSpan={2}></td>
                              </tr>
                              {rows.map((r) => {
                                const n = orderMap.get(r.id) ?? 0;
                                return (
                                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                                    <td className="px-2 py-1.5 text-center font-bold text-gray-500 text-xs">{n}</td>
                                    <td className="px-2 py-1.5 font-mono text-xs">{r.giust?.numero_doc ?? "-"}</td>
                                    <td className="px-2 py-1.5 text-xs">{r.giust?.data_doc ? formatDate(r.giust.data_doc) : "-"}</td>
                                    <td className="px-2 py-1.5 text-xs">{r.giust?.fornitore_denominazione ?? "-"}</td>
                                    <td className="px-2 py-1.5 text-xs font-medium">{r.capitolo ?? r.categoria_spesa}</td>
                                    <td className="px-2 py-1.5 text-xs">{r.misura}{r.sotto_misura ? `.${r.sotto_misura}` : ""}</td>
                                    {/* Spesa Sostenuta */}
                                    <td className="px-2 py-1.5 text-right text-xs border-l border-gray-100">{formatCurrency(r.imponibile_imputato)}</td>
                                    <td className="px-2 py-1.5 text-right text-xs">{formatCurrency(r.iva_imputato)}</td>
                                    <td className="px-2 py-1.5 text-right text-xs font-semibold">{formatCurrency(r.totale_imputato)}</td>
                                    {/* Spesa Rendicontata */}
                                    <td className="px-2 py-1.5 text-right text-xs border-l border-gray-100">{formatCurrency(r.rend_imponibile)}</td>
                                    <td className="px-2 py-1.5 text-right text-xs">{formatCurrency(r.rend_iva)}</td>
                                    <td className="px-2 py-1.5 text-right text-xs font-semibold text-blue-700">{formatCurrency(r.rend_totale)}</td>
                                    {/* Contributo Richiesto */}
                                    <td className="px-2 py-1.5 text-right text-xs border-l border-gray-100">{formatCurrency(r.rich_imponibile)}</td>
                                    <td className="px-2 py-1.5 text-right text-xs">{formatCurrency(r.rich_iva)}</td>
                                    <td className="px-2 py-1.5 text-right text-xs font-semibold text-green-700">{formatCurrency(r.rich_totale)}</td>
                                    {/* Eleggibile + Allegato */}
                                    <td className="px-2 py-1.5 text-center border-l border-gray-100">
                                      {r.eleggibile
                                        ? <span className="text-green-600 text-xs">&#10003;</span>
                                        : <span className="text-red-400 text-xs">&#10007;</span>}
                                    </td>
                                    <td className="px-2 py-1.5 text-center text-xs font-mono text-blue-600">{String(n).padStart(2, "0")}</td>
                                  </tr>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-800 text-white">
                  <tr>
                    <td className="px-2 py-2"></td>
                    <td colSpan={5} className="px-2 py-2 font-bold text-sm">TOTALE GENERALE</td>
                    <td className="px-2 py-2 text-right font-bold text-xs">{formatCurrency(totSostImp)}</td>
                    <td className="px-2 py-2 text-right font-bold text-xs">{formatCurrency(totSostIva)}</td>
                    <td className="px-2 py-2 text-right font-bold text-sm">{formatCurrency(totSostTot)}</td>
                    <td className="px-2 py-2 text-right font-bold text-xs">{formatCurrency(totRendImp)}</td>
                    <td className="px-2 py-2 text-right font-bold text-xs">{formatCurrency(totRendIva)}</td>
                    <td className="px-2 py-2 text-right font-bold text-sm text-blue-300">{formatCurrency(totRendTot)}</td>
                    <td className="px-2 py-2 text-right font-bold text-xs">{formatCurrency(totRichImp)}</td>
                    <td className="px-2 py-2 text-right font-bold text-xs">{formatCurrency(totRichIva)}</td>
                    <td className="px-2 py-2 text-right font-bold text-sm text-green-300">{formatCurrency(totRichTot)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {!searched && (
        <div className="card p-12 text-center text-gray-400">
          <p>Seleziona i filtri e clicca <strong>Applica filtri</strong> per visualizzare il quadro</p>
        </div>
      )}
    </div>
  );
}
