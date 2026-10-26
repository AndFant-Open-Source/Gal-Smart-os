// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Utility PDF — usa jsPDF + jspdf-autotable
 * Produce report professionali con intestazione GAL
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface PdfColumn {
  header: string;
  dataKey: string;
  width?: number;
  align?: "left" | "center" | "right";
}

export interface PdfOptions {
  title: string;
  subtitle?: string;
  galNome?: string;
  filename?: string;
  orientation?: "portrait" | "landscape";
  footerText?: string;
  showSignatures?: boolean;
}

// ─── Colori GAL-OS ────────────────────────────────────────────
const COLOR_HEADER_BG: [number, number, number] = [22, 101, 52];   // verde scuro
const COLOR_HEADER_TEXT: [number, number, number] = [255, 255, 255];
const COLOR_STRIPE: [number, number, number] = [240, 253, 244];     // verde chiarissimo
const COLOR_BORDER: [number, number, number] = [209, 250, 229];
const COLOR_TITLE: [number, number, number] = [22, 101, 52];

/** Crea un PDF base con header e restituisce il documento */
function createBase(opts: PdfOptions): jsPDF {
  const doc = new jsPDF({
    orientation: opts.orientation ?? "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageW = doc.internal.pageSize.getWidth();

  // ── Logo/banda intestazione ────────────────────────────────
  doc.setFillColor(...COLOR_HEADER_BG);
  doc.rect(0, 0, pageW, 20, "F");

  doc.setTextColor(...COLOR_HEADER_TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(opts.galNome ?? "GAL-OS", 10, 9);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString("it-IT", {
    day: "2-digit", month: "long", year: "numeric"
  }), pageW - 10, 9, { align: "right" });

  // ── Titolo principale ─────────────────────────────────────
  doc.setTextColor(...COLOR_TITLE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(opts.title, 10, 30);

  if (opts.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(opts.subtitle, 10, 37);
  }

  return doc;
}

/** Aggiunge firme RAF e Presidente sull'ultima pagina */
function addSignatures(doc: jsPDF) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const lastPage = doc.getNumberOfPages();
  doc.setPage(lastPage);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY ?? (pageH - 50);
  const firmaY = Math.min(finalY + 18, pageH - 35);

  // Firma RAF — sinistra
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(30, 30, 30);
  doc.text("Il Responsabile Amministrativo e Finanziario", 10 + 22, firmaY, { align: "center" });
  doc.setDrawColor(100, 100, 100);
  doc.line(10, firmaY + 12, 10 + 44, firmaY + 12);
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);
  doc.text("(RAF)", 10 + 22, firmaY + 16, { align: "center" });

  // Firma Presidente — destra
  doc.setFontSize(8);
  doc.setTextColor(30, 30, 30);
  doc.text("Il Presidente", pageW - 10 - 22, firmaY, { align: "center" });
  doc.line(pageW - 10 - 44, firmaY + 12, pageW - 10, firmaY + 12);
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);
  doc.text("(Presidente del GAL)", pageW - 10 - 22, firmaY + 16, { align: "center" });
}

/** Aggiunge numerazione pagine in footer */
function addPageNumbers(doc: jsPDF, opts: PdfOptions) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Firme sull'ultima pagina (se richiesto)
  if (opts.showSignatures !== false) {
    addSignatures(doc);
  }

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);

    if (opts.footerText) {
      doc.text(opts.footerText, 10, pageH - 8);
    }
    doc.text(`Pag. ${i} di ${pageCount}`, pageW - 10, pageH - 8, { align: "right" });

    // linea footer
    doc.setDrawColor(220, 220, 220);
    doc.line(10, pageH - 12, pageW - 10, pageH - 12);
  }
}

/**
 * Genera un PDF con tabella.
 * @param columns  Array di colonne con header e dataKey
 * @param rows     Array di oggetti dati
 * @param opts     Opzioni titolo, nome file, GAL, ecc.
 */
export function generateTablePdf(
  columns: PdfColumn[],
  rows: Record<string, string | number | null | undefined>[],
  opts: PdfOptions
): void {
  const doc = createBase(opts);
  const startY = opts.subtitle ? 44 : 38;

  const colStyles: Record<string, { halign: string; cellWidth?: number }> = {};
  columns.forEach((c) => {
    colStyles[c.dataKey] = {
      halign: c.align ?? "left",
      ...(c.width ? { cellWidth: c.width } : {}),
    };
  });

  autoTable(doc, {
    startY,
    columns: columns.map((c) => ({ header: c.header, dataKey: c.dataKey })),
    body: rows as Record<string, string>[],
    columnStyles: colStyles as Record<string, object>,
    headStyles: {
      fillColor: COLOR_HEADER_BG,
      textColor: COLOR_HEADER_TEXT,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [40, 40, 40],
    },
    alternateRowStyles: {
      fillColor: COLOR_STRIPE,
    },
    tableLineColor: COLOR_BORDER,
    tableLineWidth: 0.1,
    margin: { left: 10, right: 10 },
    didDrawPage: () => {
      // Ribadisci la banda verde su ogni pagina nuova
      const pageW = doc.internal.pageSize.getWidth();
      doc.setFillColor(...COLOR_HEADER_BG);
      doc.rect(0, 0, pageW, 20, "F");
    },
  });

  addPageNumbers(doc, opts);
  doc.save(opts.filename ?? `${opts.title.replace(/\s+/g, "_")}.pdf`);
}

/**
 * Stampa PDF con sezioni multiple (es. riepilogo + dettaglio)
 * Ogni sezione ha un titolo e la propria tabella
 */
export interface PdfSection {
  title: string;
  columns: PdfColumn[];
  rows: Record<string, string | number | null | undefined>[];
  summary?: { label: string; value: string }[];
}

export function generateMultiSectionPdf(
  sections: PdfSection[],
  opts: PdfOptions
): void {
  const doc = createBase(opts);
  let startY = opts.subtitle ? 44 : 38;

  for (const section of sections) {
    // Titolo sezione
    if (section.title) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...COLOR_TITLE);
      doc.text(section.title, 10, startY + 6);
      startY += 10;
    }

    // Tabella sezione
    autoTable(doc, {
      startY,
      columns: section.columns.map((c) => ({ header: c.header, dataKey: c.dataKey })),
      body: section.rows as Record<string, string>[],
      headStyles: {
        fillColor: COLOR_HEADER_BG,
        textColor: COLOR_HEADER_TEXT,
        fontStyle: "bold",
        fontSize: 8,
      },
      bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
      alternateRowStyles: { fillColor: COLOR_STRIPE },
      tableLineColor: COLOR_BORDER,
      tableLineWidth: 0.1,
      margin: { left: 10, right: 10 },
    });

    startY = (doc as any).lastAutoTable.finalY + 8;

    // Summary box (totali)
    if (section.summary) {
      doc.setFillColor(243, 244, 246);
      doc.roundedRect(10, startY, doc.internal.pageSize.getWidth() - 20, 7 * section.summary.length + 4, 2, 2, "F");
      doc.setFontSize(9);
      section.summary.forEach((s, i) => {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(40, 40, 40);
        doc.text(s.label + ":", 14, startY + 7 + i * 7);
        doc.setFont("helvetica", "normal");
        doc.text(s.value, 100, startY + 7 + i * 7);
      });
      startY += 7 * section.summary.length + 12;
    }
  }

  addPageNumbers(doc, opts);
  doc.save(opts.filename ?? `${opts.title.replace(/\s+/g, "_")}.pdf`);
}

/** Formatta numero come valuta IT per PDF */
export function pdfEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency", currency: "EUR", minimumFractionDigits: 2,
  }).format(v);
}

/** Formatta data ISO → dd/mm/yyyy per PDF */
export function pdfDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("it-IT");
  } catch {
    return d;
  }
}
