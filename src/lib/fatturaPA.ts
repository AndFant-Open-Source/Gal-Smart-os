// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Parser per Fattura Elettronica italiana (FatturaPA / FatturaB2B)
 * Formato XML standard: https://www.fatturapa.gov.it
 * Gestisce: namespace prefixes, xmlns declarations, file .p7m, encoding BOM, multi-aliquota
 */

export interface FatturaParsed {
  // Cedente/Prestatore (il fornitore)
  fornitore_piva: string;
  fornitore_cf: string;
  fornitore_denominazione: string;
  fornitore_indirizzo: string;
  fornitore_comune: string;
  fornitore_provincia: string;

  // Dati documento
  numero_doc: string;
  data_doc: string;       // ISO date YYYY-MM-DD
  tipo_doc: string;       // TD01=fattura, TD04=nota credito, ecc.
  tipo_doc_label: string;

  // Importi
  imponibile: number;
  iva: number;
  aliquota_iva: number;
  totale: number;

  // Optional
  cig: string;
  cup: string;
  causale: string;

  // Dati per lo scadenzario pagamenti (GAL-OS 4.0)
  ritenuta: number;              // DatiRitenuta/ImportoRitenuta (somma)
  ritenuta_tipo: string;         // RT01 persone fisiche, RT02 persone giuridiche, ...
  split_payment: boolean;        // EsigibilitaIVA = S
  iban: string;                  // DettaglioPagamento/IBAN
  data_scadenza_pagamento: string; // DettaglioPagamento/DataScadenzaPagamento
  importo_pagamento: number;     // DettaglioPagamento/ImportoPagamento
}

const TIPO_DOC_MAP: Record<string, string> = {
  TD01: "fattura", TD02: "fattura", TD03: "fattura",
  TD04: "nota_credito", TD05: "nota_credito",
  TD06: "fattura", TD07: "fattura",
  TD08: "nota_credito", TD09: "nota_credito",
  TD16: "fattura", TD17: "fattura", TD18: "fattura",
  TD19: "fattura", TD20: "fattura", TD21: "fattura",
  TD22: "fattura", TD23: "fattura", TD24: "fattura",
  TD25: "fattura", TD26: "fattura", TD27: "fattura",
};

/**
 * Rimuove TUTTI i namespace dall'XML per garantire compatibilità col DOMParser.
 * 1. Rimuove prefissi dai tag: <p:FatturaElettronica> → <FatturaElettronica>
 * 2. Rimuove tutte le dichiarazioni xmlns="..." e xmlns:xxx="..."
 */
function stripAllNamespaces(xml: string): string {
  // 1. Rimuove prefissi dai tag di apertura e chiusura
  //    es: <p:Tag> → <Tag>, </ns2:Tag> → </Tag>
  let result = xml.replace(/<(\/?)[a-zA-Z0-9]+:/g, "<$1");

  // 2. Rimuove dichiarazioni xmlns (con e senza prefisso)
  //    es: xmlns="http://..." → rimosso
  //    es: xmlns:p="http://..." → rimosso
  //    es: xmlns:xsi="http://..." → rimosso
  result = result.replace(/\s+xmlns(?::[a-zA-Z0-9]+)?="[^"]*"/g, "");
  result = result.replace(/\s+xmlns(?::[a-zA-Z0-9]+)?='[^']*'/g, "");

  // 3. Rimuove attributi xsi:xxx (es. xsi:schemaLocation)
  result = result.replace(/\s+xsi:[a-zA-Z]+="[^"]*"/g, "");

  return result;
}

/**
 * Estrae il contenuto XML da un file .p7m (firmato digitalmente)
 * Il file .p7m contiene una busta PKCS#7 con l'XML dentro
 */
function extractXmlFromP7m(content: string): string {
  // Cerca l'inizio dell'XML nel contenuto binario
  const xmlStart = content.indexOf("<?xml");
  if (xmlStart >= 0) {
    // Trova la fine dell'XML (ultimo tag di chiusura)
    const possibleEnds = [
      content.lastIndexOf("</FatturaElettronica>"),
      content.lastIndexOf("</p:FatturaElettronica>"),
      content.lastIndexOf("</ns2:FatturaElettronica>"),
      content.lastIndexOf("</ns3:FatturaElettronica>"),
    ];
    const validEnds = possibleEnds.filter((i) => i > xmlStart);
    if (validEnds.length > 0) {
      const endPos = Math.max(...validEnds);
      // Trova la fine completa del tag
      const tagEnd = content.indexOf(">", endPos);
      return content.substring(xmlStart, tagEnd + 1);
    }
    return content.substring(xmlStart);
  }
  // Prova a cercare senza il prologo xml
  const feStart = content.search(/<[a-zA-Z0-9:]*FatturaElettronica/);
  if (feStart >= 0) {
    return content.substring(feStart);
  }
  return content;
}

/**
 * Trova testo all'interno di un elemento navigando gerarchicamente i tag.
 * Usa getElementsByTagName che funziona anche senza namespace.
 */
function getText(el: Element | null, ...tags: string[]): string {
  if (!el) return "";
  let current: Element = el;
  for (const tag of tags) {
    const found: Element | undefined = current.getElementsByTagName(tag)[0];
    if (!found) return "";
    current = found;
  }
  return current.textContent?.trim() ?? "";
}

function getNum(el: Element | null, ...tags: string[]): number {
  const t = getText(el, ...tags);
  return t ? parseFloat(t.replace(",", ".")) : 0;
}

/** Cerca tutti gli elementi nel documento per tagName */
function findAll(doc: Document, tagName: string): Element[] {
  return Array.from(doc.getElementsByTagName(tagName));
}

function findFirst(doc: Document, tagName: string): Element | null {
  return doc.getElementsByTagName(tagName)[0] ?? null;
}

export function parseFatturaPA(xmlContent: string): FatturaParsed {
  // 1. Pulisci: BOM, estrai da p7m, rimuovi tutti i namespace
  let cleaned = xmlContent.replace(/^\uFEFF/, ""); // Rimuove BOM
  cleaned = extractXmlFromP7m(cleaned);
  cleaned = stripAllNamespaces(cleaned);

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleaned, "application/xml");

  // Controlla se il parsing XML è fallito
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    // Riprova come text/html per massima compatibilità
    const doc2 = parser.parseFromString(cleaned, "text/html");
    return extractFromDoc(doc2);
  }

  return extractFromDoc(doc);
}

function extractFromDoc(doc: Document): FatturaParsed {
  // ── Cedente (fornitore) ───────────────────────────────────────────
  const cedente = findFirst(doc, "CedentePrestatore");
  const datiAnagCed = cedente ? cedente.getElementsByTagName("DatiAnagrafici")[0] ?? null : null;
  const idIvaCed = datiAnagCed ? datiAnagCed.getElementsByTagName("IdFiscaleIVA")[0] ?? null : null;
  const anagCed = datiAnagCed ? datiAnagCed.getElementsByTagName("Anagrafica")[0] ?? null : null;
  const sedeCed = cedente ? cedente.getElementsByTagName("Sede")[0] ?? null : null;

  const piva = getText(idIvaCed, "IdCodice");
  const cf = getText(datiAnagCed, "CodiceFiscale");
  const denominazione =
    getText(anagCed, "Denominazione") ||
    `${getText(anagCed, "Nome")} ${getText(anagCed, "Cognome")}`.trim();

  // ── Dati generali documento ───────────────────────────────────────
  const datiGen = findFirst(doc, "DatiGeneraliDocumento");
  const tipoDocCode = getText(datiGen, "TipoDocumento");
  const dataRaw = getText(datiGen, "Data");
  const numero = getText(datiGen, "Numero");

  // Causale: può essere multipla, unisci tutte
  const causaleEls = datiGen ? Array.from(datiGen.getElementsByTagName("Causale")) : [];
  const causale = causaleEls.map((el) => el.textContent?.trim() ?? "").filter(Boolean).join(" | ");

  // CIG / CUP: cerca in DatiOrdineAcquisto, DatiContratto, DatiConvenzione
  let cig = "";
  let cup = "";
  for (const tag of ["DatiOrdineAcquisto", "DatiContratto", "DatiConvenzione"]) {
    const els = findAll(doc, tag);
    for (const el of els) {
      if (!cig) cig = getText(el, "CodiceCIG");
      if (!cup) cup = getText(el, "CodiceCUP");
    }
  }

  // ── Importi — legge da DatiRiepilogo (può essere multiplo) ────────
  const riepilogos = findAll(doc, "DatiRiepilogo");
  let imponibile = 0;
  let iva = 0;
  let aliquota = 0;

  riepilogos.forEach((r) => {
    imponibile += getNum(r, "ImponibileImporto");
    iva += getNum(r, "Imposta");
    const ali = getNum(r, "AliquotaIVA");
    if (ali > 0) aliquota = ali; // Prendi l'ultima aliquota > 0
  });

  // Fallback: totale dal documento
  const totaleDoc = getNum(datiGen, "ImportoTotaleDocumento");
  if (imponibile === 0 && totaleDoc > 0) {
    imponibile = totaleDoc;
    iva = 0;
  }
  const totale = imponibile + iva || totaleDoc;

  // Data: normalizza YYYY-MM-DD
  let dataDoc = dataRaw;
  if (dataRaw && !dataRaw.includes("-")) {
    // Formato YYYYMMDD → YYYY-MM-DD
    if (dataRaw.length === 8) {
      dataDoc = `${dataRaw.slice(0, 4)}-${dataRaw.slice(4, 6)}-${dataRaw.slice(6, 8)}`;
    }
  } else if (dataRaw) {
    dataDoc = dataRaw.slice(0, 10); // Tronca eventuali T00:00:00
  }

  // Fallback CIG/CUP: cerca il codice nel testo libero (causale, descrizioni righe)
  // Testo dei soli nodi foglia separato da spazi (evita che valori adiacenti si fondano)
  const testo = Array.from(doc.getElementsByTagName("*"))
    .filter((el) => el.children.length === 0)
    .map((el) => el.textContent ?? "")
    .join(" ")
    .toUpperCase();
  if (!cup) {
    const m = testo.match(/C\.?\s?U\.?\s?P\.?\s*[:N.°\s-]*([A-Z][0-9]{2}[A-Z0-9]{12})/);
    if (m) cup = m[1];
  }
  if (!cig) {
    const m = testo.match(/C\.?\s?I\.?\s?G\.?\s*[:N.°\s-]*([A-Z0-9]{10})(?![A-Z0-9])/);
    if (m) cig = m[1];
  }

  // Ritenute (possono essere più blocchi DatiRitenuta)
  let ritenuta = 0;
  let ritenutaTipo = "";
  findAll(doc, "DatiRitenuta").forEach((r) => {
    ritenuta += getNum(r, "ImportoRitenuta");
    if (!ritenutaTipo) ritenutaTipo = getText(r, "TipoRitenuta");
  });

  const splitPayment = riepilogos.some((r) => getText(r, "EsigibilitaIVA") === "S");

  const dettPag = findFirst(doc, "DettaglioPagamento");
  const ibanPag = getText(dettPag, "IBAN");
  const scadPagRaw = getText(dettPag, "DataScadenzaPagamento");
  const importoPag = getNum(dettPag, "ImportoPagamento");

  return {
    ritenuta: Math.round(ritenuta * 100) / 100,
    ritenuta_tipo: ritenutaTipo,
    split_payment: splitPayment,
    iban: ibanPag.replace(/\s/g, ""),
    data_scadenza_pagamento: scadPagRaw ? scadPagRaw.slice(0, 10) : "",
    importo_pagamento: Math.round(importoPag * 100) / 100,
    fornitore_piva: piva,
    fornitore_cf: cf,
    fornitore_denominazione: denominazione,
    fornitore_indirizzo: getText(sedeCed, "Indirizzo"),
    fornitore_comune: getText(sedeCed, "Comune"),
    fornitore_provincia: getText(sedeCed, "Provincia"),
    numero_doc: numero,
    data_doc: dataDoc,
    tipo_doc: TIPO_DOC_MAP[tipoDocCode] ?? "fattura",
    tipo_doc_label: tipoDocCode,
    imponibile: Math.round(imponibile * 100) / 100,
    iva: Math.round(iva * 100) / 100,
    aliquota_iva: aliquota,
    totale: Math.round(totale * 100) / 100,
    cig,
    cup,
    causale,
  };
}

/** Legge un File XML e restituisce il parsed result */
export function readFatturaXml(file: File): Promise<FatturaParsed> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        if (!content || content.length < 10) {
          reject(new Error("File vuoto o troppo piccolo"));
          return;
        }
        const result = parseFatturaPA(content);
        // Verifica che almeno il numero documento sia stato estratto
        if (!result.numero_doc && !result.fornitore_denominazione && result.imponibile === 0) {
          reject(new Error("Impossibile estrarre i dati dalla fattura. Verifica che il file sia un XML FatturaPA valido."));
          return;
        }
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Errore lettura file"));
    // Prova UTF-8, se il file ha un encoding diverso il BOM fix gestisce
    reader.readAsText(file, "utf-8");
  });
}
