// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Generatore di file Excel (.xlsx) con TABELLE EXCEL STRUTTURATE.
 *
 * SheetJS (versione libera) non crea le "Tabelle" di Excel (Inserisci > Tabella),
 * quindi il pacchetto .xlsx viene scritto direttamente con JSZip:
 *   - un foglio per sezione, con titolo, sottotitolo e una tabella formattata
 *     (intestazioni, filtri, righe alternate, prima riga bloccata);
 *   - date come vere date Excel (gg/mm/aaaa), importi in formato euro;
 *   - un foglio "Indice" con il riepilogo e i collegamenti ai fogli.
 */
import JSZip from "jszip";

export type ValoreCella = string | number | boolean | Date | null | undefined;
export type FormatoColonna = "testo" | "numero" | "intero" | "euro" | "data" | "dataora";

export interface ColonnaExcel {
  titolo: string;
  formato: FormatoColonna;
}

export interface FoglioExcel {
  nome: string;            // nome del foglio (max 31 caratteri)
  titolo: string;          // titolo mostrato nella prima riga
  sottotitolo?: string;
  gruppo?: string;         // raggruppamento mostrato nell'Indice
  colonne: ColonnaExcel[];
  righe: ValoreCella[][];
}

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Indici degli stili in styles.xml (cellXfs)
const ST = { normale: 0, data: 1, dataora: 2, euro: 3, titolo: 4, sottotitolo: 5, numero: 6, link: 7, intestazioneIndice: 8, intero: 9 };
const RIGA_INTESTAZIONE = 3; // la tabella parte dalla riga 3 (righe 1-2: titolo e sottotitolo)

function xml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lettera(col: number): string {
  let s = "";
  let n = col + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Numero di serie Excel per una data (giorni dal 30/12/1899), ora locale */
function serialeExcel(d: Date): number {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Converte una stringa ISO (data o data-ora) in Date, oppure null */
export function dataDaIso(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (!m) return null;
  if (m[4] === undefined) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cella(ref: string, v: ValoreCella, formato: FormatoColonna): string {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) {
    const stile = formato === "dataora" ? ST.dataora : ST.data;
    return `<c r="${ref}" s="${stile}"><v>${serialeExcel(v)}</v></c>`;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const stile = formato === "euro" ? ST.euro : formato === "numero" ? ST.numero : formato === "intero" ? ST.intero : ST.normale;
    return `<c r="${ref}" s="${stile}"><v>${v}</v></c>`;
  }
  const testo = typeof v === "boolean" ? (v ? "Sì" : "No") : String(v);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(testo.slice(0, 32000))}</t></is></c>`;
}

function testoCella(ref: string, testo: string, stile: number): string {
  return `<c r="${ref}" t="inlineStr" s="${stile}"><is><t xml:space="preserve">${xml(testo)}</t></is></c>`;
}

/** Nomi colonna unici (richiesto dalle tabelle Excel) */
function intestazioniUniche(colonne: ColonnaExcel[]): string[] {
  const visti = new Map<string, number>();
  return colonne.map((c) => {
    const base = (c.titolo || "Colonna").replace(/[\r\n]+/g, " ").trim() || "Colonna";
    const n = (visti.get(base.toLowerCase()) ?? 0) + 1;
    visti.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function larghezze(f: FoglioExcel, intestazioni: string[]): number[] {
  return intestazioni.map((h, i) => {
    let max = h.length + 3; // spazio per la freccia del filtro
    const formato = f.colonne[i].formato;
    if (formato === "data") max = Math.max(max, 11);
    if (formato === "dataora") max = Math.max(max, 16);
    for (const r of f.righe.slice(0, 500)) {
      const v = r[i];
      if (v === null || v === undefined) continue;
      const len = v instanceof Date ? 10 : typeof v === "number" ? String(Math.round(v)).length + 6 : String(v).length;
      if (len > max) max = len;
    }
    return Math.min(Math.max(max, 8), 60);
  });
}

function nomeFoglioValido(nome: string, usati: Set<string>): string {
  let base = nome.replace(/[[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Foglio";
  let n = 2;
  let finale = base;
  while (usati.has(finale.toLowerCase())) {
    const suff = ` (${n++})`;
    finale = base.slice(0, 31 - suff.length) + suff;
  }
  usati.add(finale.toLowerCase());
  base = finale;
  return base;
}

function foglioDati(f: FoglioExcel, idTabella: number): { sheet: string; table: string } {
  const intestazioni = intestazioniUniche(f.colonne);
  const nCol = Math.max(intestazioni.length, 1);
  const ultimaCol = lettera(nCol - 1);
  const ultimaRiga = RIGA_INTESTAZIONE + Math.max(f.righe.length, 1);
  const ref = `A${RIGA_INTESTAZIONE}:${ultimaCol}${ultimaRiga}`;

  const righe: string[] = [];
  righe.push(`<row r="1" ht="22" customHeight="1">${testoCella("A1", f.titolo, ST.titolo)}</row>`);
  if (f.sottotitolo) righe.push(`<row r="2">${testoCella("A2", f.sottotitolo, ST.sottotitolo)}</row>`);
  righe.push(`<row r="${RIGA_INTESTAZIONE}">${intestazioni.map((h, i) => testoCella(`${lettera(i)}${RIGA_INTESTAZIONE}`, h, ST.normale)).join("")}</row>`);
  f.righe.forEach((r, ri) => {
    const nr = RIGA_INTESTAZIONE + 1 + ri;
    const celle = f.colonne.map((c, ci) => cella(`${lettera(ci)}${nr}`, r[ci], c.formato)).join("");
    righe.push(`<row r="${nr}">${celle}</row>`);
  });

  const cols = larghezze(f, intestazioni)
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${RIGA_INTESTAZIONE}" topLeftCell="A${RIGA_INTESTAZIONE + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${righe.join("")}</sheetData>` +
    `<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>` +
    `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` +
    `</worksheet>`;

  const nomeTabella = `T${idTabella}_${f.nome.normalize("NFD").replace(/[^A-Za-z0-9]/g, "")}`.slice(0, 250);
  const table =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<table xmlns="${NS}" id="${idTabella}" name="${nomeTabella}" displayName="${nomeTabella}" ref="${ref}" totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${nCol}">${intestazioni.map((h, i) => `<tableColumn id="${i + 1}" name="${xml(h)}"/>`).join("")}</tableColumns>` +
    `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
    `</table>`;
  return { sheet, table };
}

function foglioIndice(titolo: string, sottotitolo: string, fogli: FoglioExcel[], nomi: string[]): string {
  const righe: string[] = [];
  righe.push(`<row r="1" ht="24" customHeight="1">${testoCella("A1", titolo, ST.titolo)}</row>`);
  righe.push(`<row r="2">${testoCella("A2", sottotitolo, ST.sottotitolo)}</row>`);
  righe.push(`<row r="4">${testoCella("A4", "Area", ST.intestazioneIndice)}${testoCella("B4", "Sezione (foglio)", ST.intestazioneIndice)}${testoCella("C4", "Record", ST.intestazioneIndice)}</row>`);
  const links: string[] = [];
  fogli.forEach((f, i) => {
    const r = 5 + i;
    links.push(`<hyperlink ref="B${r}" location="'${nomi[i].replace(/'/g, "''")}'!A1" display="${xml(nomi[i])}"/>`);
    righe.push(`<row r="${r}">${testoCella(`A${r}`, f.gruppo ?? "", ST.normale)}${testoCella(`B${r}`, nomi[i], ST.link)}<c r="C${r}" s="${ST.intero}"><v>${f.righe.length}</v></c></row>`);
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<sheetViews><sheetView workbookViewId="0" tabSelected="1"/></sheetViews>` +
    `<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="38" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/></cols>` +
    `<sheetData>${righe.join("")}</sheetData>` +
    (links.length ? `<hyperlinks>${links.join("")}</hyperlinks>` : "") +
    `</worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="${NS}">` +
  `<numFmts count="3">` +
  `<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>` +
  `<numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/>` +
  `<numFmt numFmtId="166" formatCode="#,##0.00 &quot;€&quot;;[Red]-#,##0.00 &quot;€&quot;"/>` +
  `</numFmts>` +
  `<fonts count="5">` +
  `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="15"/><color rgb="FF166534"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>` +
  `</fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF166534"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="10">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normale" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** Crea il file .xlsx e restituisce il Blob */
export async function creaFileExcel(params: { titolo: string; sottotitolo: string; fogli: FoglioExcel[] }): Promise<Blob> {
  const zip = new JSZip();
  const usati = new Set<string>(["indice"]);
  const nomi = params.fogli.map((f) => nomeFoglioValido(f.nome, usati));

  const ct: string[] = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ];
  const sheetsXml: string[] = [`<sheet name="Indice" sheetId="1" r:id="rId1"/>`];
  const wbRels: string[] = [`<Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/>`];

  zip.file("xl/worksheets/sheet1.xml", foglioIndice(params.titolo, params.sottotitolo, params.fogli, nomi));

  params.fogli.forEach((f, i) => {
    const n = i + 2; // sheet2, sheet3, …
    const { sheet, table } = foglioDati({ ...f, nome: nomi[i] }, i + 1);
    zip.file(`xl/worksheets/sheet${n}.xml`, sheet);
    zip.file(`xl/tables/table${i + 1}.xml`, table);
    zip.file(
      `xl/worksheets/_rels/sheet${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS_R}/table" Target="../tables/table${i + 1}.xml"/></Relationships>`
    );
    ct.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    ct.push(`<Override PartName="/xl/tables/table${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
    sheetsXml.push(`<sheet name="${xml(nomi[i])}" sheetId="${n}" r:id="rId${n}"/>`);
    wbRels.push(`<Relationship Id="rId${n}" Type="${NS_R}/worksheet" Target="worksheets/sheet${n}.xml"/>`);
  });
  const nStyles = params.fogli.length + 2;
  wbRels.push(`<Relationship Id="rId${nStyles}" Type="${NS_R}/styles" Target="styles.xml"/>`);

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${ct.join("")}</Types>`);
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xml(params.titolo)}</dc:title><dc:creator>GAL Smart</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheetsXml.join("")}</sheets></workbook>`
  );
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels.join("")}</Relationships>`);
  zip.file("xl/styles.xml", STYLES);

  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
}
