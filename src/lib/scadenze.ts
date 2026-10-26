// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Logica di supporto per Agenda e Scadenzario pagamenti (GAL-OS 4.0)
 */
import {
  addMonths, addDays, differenceInCalendarDays, format, getDay, parseISO, startOfDay,
} from "date-fns";
import type { Ricorrenza, ScadenzaPagamento } from "../types";

/** Data odierna in formato ISO (YYYY-MM-DD), ora locale */
export function oggiISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function toISO(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Giorni mancanti alla data (negativo = scaduta) */
export function giorniAllaScadenza(dataISO: string): number {
  return differenceInCalendarDays(parseISO(dataISO), startOfDay(new Date()));
}

/** Etichetta leggibile della distanza dalla scadenza */
export function etichettaScadenza(dataISO: string): { testo: string; classe: string } {
  const g = giorniAllaScadenza(dataISO);
  if (g < 0) return { testo: `Scaduta da ${-g} gg`, classe: "text-red-600 font-semibold" };
  if (g === 0) return { testo: "Scade oggi", classe: "text-red-600 font-semibold" };
  if (g === 1) return { testo: "Domani", classe: "text-orange-600 font-medium" };
  if (g <= 7) return { testo: `Tra ${g} gg`, classe: "text-orange-600 font-medium" };
  if (g <= 30) return { testo: `Tra ${g} gg`, classe: "text-yellow-700" };
  return { testo: `Tra ${g} gg`, classe: "text-gray-500" };
}

/**
 * Scadenza di versamento delle ritenute con F24:
 * entro il giorno 16 del mese successivo a quello del pagamento.
 * - Se il 16 cade di sabato o domenica slitta al lunedì successivo.
 * - Per il mese di agosto si applica la proroga di Ferragosto al giorno 20.
 */
export function scadenzaF24(dataPagamentoISO: string): string {
  const pag = parseISO(dataPagamentoISO);
  const meseSucc = addMonths(new Date(pag.getFullYear(), pag.getMonth(), 1), 1);
  const giorno = meseSucc.getMonth() === 7 ? 20 : 16; // agosto → 20
  let d = new Date(meseSucc.getFullYear(), meseSucc.getMonth(), giorno);
  const dow = getDay(d);
  if (dow === 6) d = addDays(d, 2);
  else if (dow === 0) d = addDays(d, 1);
  return toISO(d);
}

/** Prossima data in base alla ricorrenza (per pratiche ricorrenti) */
export function prossimaDataRicorrenza(dataISO: string, ricorrenza: Ricorrenza): string | null {
  const mesi: Record<Ricorrenza, number> = {
    nessuna: 0, mensile: 1, trimestrale: 3, semestrale: 6, annuale: 12,
  };
  const m = mesi[ricorrenza];
  if (!m) return null;
  return toISO(addMonths(parseISO(dataISO), m));
}

// ─── Codici di tracciabilità ────────────────────────────────────

/** CUP: 15 caratteri alfanumerici (lettera + 2 cifre + 12 alfanumerici) */
export function cupValido(cup: string): boolean {
  return /^[A-Z][0-9]{2}[A-Z0-9]{12}$/.test(cup.trim().toUpperCase());
}

/** CIG: 10 caratteri alfanumerici (CIG ordinario o Smart CIG) */
export function cigValido(cig: string): boolean {
  return /^[A-Z0-9]{10}$/.test(cig.trim().toUpperCase());
}

export function normalizzaCodice(v: string): string {
  return v.replace(/\s/g, "").toUpperCase();
}

export interface EsitoVerifica {
  livello: "ok" | "avviso" | "errore";
  messaggio: string;
}

/**
 * Verifica coerenza tra i codici indicati nella scadenza e quelli presenti in fattura.
 * `codiciFattura` è null quando non è stata caricata/letta una fattura XML.
 */
export function verificaTracciabilita(params: {
  cup: string;
  cig: string;
  cigEsente: boolean;
  codiciFattura: { cup: string; cig: string } | null;
}): EsitoVerifica[] {
  const out: EsitoVerifica[] = [];
  const cup = normalizzaCodice(params.cup);
  const cig = normalizzaCodice(params.cig);

  if (!cup) out.push({ livello: "errore", messaggio: "Il CUP è obbligatorio per ogni pagamento." });
  else if (!cupValido(cup)) out.push({ livello: "errore", messaggio: "Il CUP indicato non ha un formato valido (15 caratteri)." });

  if (!params.cigEsente) {
    if (!cig) out.push({ livello: "errore", messaggio: "Il CIG è obbligatorio: indicalo oppure motiva l'esclusione." });
    else if (!cigValido(cig)) out.push({ livello: "errore", messaggio: "Il CIG indicato non ha un formato valido (10 caratteri)." });
  }

  const f = params.codiciFattura;
  if (f) {
    const fCup = normalizzaCodice(f.cup);
    const fCig = normalizzaCodice(f.cig);
    if (!fCup) out.push({ livello: "avviso", messaggio: "La fattura NON riporta il CUP: richiedere integrazione/nota al fornitore." });
    else if (cup && fCup !== cup) out.push({ livello: "errore", messaggio: `CUP in fattura (${fCup}) diverso da quello indicato (${cup}).` });
    else out.push({ livello: "ok", messaggio: `CUP presente in fattura e coerente (${fCup}).` });

    if (!params.cigEsente) {
      if (!fCig) out.push({ livello: "avviso", messaggio: "La fattura NON riporta il CIG: richiedere integrazione al fornitore." });
      else if (cig && fCig !== cig) out.push({ livello: "errore", messaggio: `CIG in fattura (${fCig}) diverso da quello indicato (${cig}).` });
      else out.push({ livello: "ok", messaggio: `CIG presente in fattura e coerente (${fCig}).` });
    }
  }
  return out;
}

/**
 * Importo netto da pagare al beneficiario:
 * totale documento − IVA (se split payment) − ritenuta d'acconto
 */
export function calcolaNettoDaPagare(s: {
  imponibile: number; iva: number; split_payment: boolean; ritenuta: number;
}): { totale: number; netto: number } {
  const totale = round2(s.imponibile + s.iva);
  const netto = round2(totale - (s.split_payment ? s.iva : 0) - s.ritenuta);
  return { totale, netto };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Una scadenza è "aperta" se non è pagata né annullata */
export function scadenzaAperta(s: Pick<ScadenzaPagamento, "stato">): boolean {
  return s.stato === "da_pagare" || s.stato === "in_pagamento";
}
