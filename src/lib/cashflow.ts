// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Calcoli del cash flow (GAL-OS 4.0)
 * Fonti:
 *  - uscite realizzate: scadenze pagate (data_pagamento, importo_pagato) + movimenti "uscita" realizzati
 *  - uscite previste:   scadenze da pagare/in pagamento (data_scadenza) + movimenti "uscita" previsti
 *  - entrate:           movimenti "entrata" (realizzati alla data_effettiva, previsti alla data_prevista)
 * Le voci previste già scadute vengono considerate "da regolare oggi".
 */
import { addDays, endOfMonth, format } from "date-fns";
import type { ContoCorrente, MovimentoCassa, ScadenzaPagamento } from "../types";
import { oggiISO, round2 } from "./scadenze";

export interface Flusso {
  data: string;         // data di competenza di cassa (YYYY-MM-DD)
  importo: number;      // positivo = entrata, negativo = uscita
  realizzato: boolean;
  contoId: string | null;
  fonte: "scadenza" | "movimento";
  categoria: string;
  descrizione: string;
}

export function costruisciFlussi(scadenze: ScadenzaPagamento[], movimenti: MovimentoCassa[]): Flusso[] {
  const oggi = oggiISO();
  const out: Flusso[] = [];
  for (const s of scadenze) {
    if (s.stato === "annullata") continue;
    if (s.stato === "pagata") {
      out.push({
        data: s.data_pagamento ?? s.data_scadenza,
        importo: -Number(s.importo_pagato ?? s.importo_da_pagare),
        realizzato: true, contoId: s.conto_id, fonte: "scadenza", categoria: s.tipo,
        descrizione: `${s.beneficiario} — ${s.descrizione}`,
      });
    } else {
      out.push({
        data: s.data_scadenza < oggi ? oggi : s.data_scadenza,
        importo: -Number(s.importo_da_pagare),
        realizzato: false, contoId: s.conto_id, fonte: "scadenza", categoria: s.tipo,
        descrizione: `${s.beneficiario} — ${s.descrizione}`,
      });
    }
  }
  for (const m of movimenti) {
    if (m.stato === "annullato") continue;
    const segno = m.tipo === "entrata" ? 1 : -1;
    const realizzato = m.stato === "realizzato";
    const data = realizzato ? m.data_effettiva ?? m.data_prevista : m.data_prevista < oggi ? oggi : m.data_prevista;
    out.push({
      data, importo: segno * Number(m.importo), realizzato, contoId: m.conto_id, fonte: "movimento",
      categoria: m.categoria, descrizione: m.descrizione,
    });
  }
  return out;
}

/** Saldo attuale di ciascun conto: saldo iniziale + movimenti realizzati dalla data del saldo iniziale */
export function saldiConti(conti: ContoCorrente[], flussi: Flusso[]): Map<string, number> {
  const mappa = new Map<string, number>();
  for (const c of conti) {
    const mov = flussi
      .filter((f) => f.realizzato && f.contoId === c.id && f.data >= c.data_saldo_iniziale)
      .reduce((t, f) => t + f.importo, 0);
    mappa.set(c.id, round2(Number(c.saldo_iniziale) + mov));
  }
  return mappa;
}

/** Liquidità complessiva attuale (conti + flussi realizzati non assegnati a un conto) */
export function liquiditaAttuale(conti: ContoCorrente[], flussi: Flusso[]): number {
  const saldi = saldiConti(conti, flussi);
  const totConti = [...saldi.values()].reduce((t, v) => t + v, 0);
  const oggi = oggiISO();
  const nonAssegnati = flussi
    .filter((f) => f.realizzato && !f.contoId && f.data <= oggi)
    .reduce((t, f) => t + f.importo, 0);
  return round2(totConti + nonAssegnati);
}

export interface MeseCashFlow {
  mese: number;            // 0-11
  entrateRealizzate: number;
  usciteRealizzate: number; // valore positivo
  entratePreviste: number;
  uscitePreviste: number;   // valore positivo
  saldoFineMese: number;
  futuro: boolean;
}

export function analisiMensile(anno: number, flussi: Flusso[], liquidita: number): MeseCashFlow[] {
  const oggi = oggiISO();
  const mesi: MeseCashFlow[] = [];
  for (let m = 0; m < 12; m++) {
    const prefisso = `${anno}-${String(m + 1).padStart(2, "0")}`;
    const delMese = flussi.filter((f) => f.data.startsWith(prefisso));
    const fine = format(endOfMonth(new Date(anno, m, 1)), "yyyy-MM-dd");
    let saldo: number;
    if (fine < oggi) {
      // Mese passato: ricostruisco a ritroso togliendo il realizzato successivo
      const dopo = flussi.filter((f) => f.realizzato && f.data > fine && f.data <= oggi).reduce((t, f) => t + f.importo, 0);
      saldo = liquidita - dopo;
    } else {
      // Mese corrente/futuro: liquidità + previsto fino a fine mese
      const previsto = flussi.filter((f) => !f.realizzato && f.data <= fine).reduce((t, f) => t + f.importo, 0);
      const realizzatoFuturo = flussi.filter((f) => f.realizzato && f.data > oggi && f.data <= fine).reduce((t, f) => t + f.importo, 0);
      saldo = liquidita + previsto + realizzatoFuturo;
    }
    mesi.push({
      mese: m,
      entrateRealizzate: round2(delMese.filter((f) => f.realizzato && f.importo > 0).reduce((t, f) => t + f.importo, 0)),
      usciteRealizzate: round2(-delMese.filter((f) => f.realizzato && f.importo < 0).reduce((t, f) => t + f.importo, 0)),
      entratePreviste: round2(delMese.filter((f) => !f.realizzato && f.importo > 0).reduce((t, f) => t + f.importo, 0)),
      uscitePreviste: round2(-delMese.filter((f) => !f.realizzato && f.importo < 0).reduce((t, f) => t + f.importo, 0)),
      saldoFineMese: round2(saldo),
      futuro: fine >= oggi,
    });
  }
  return mesi;
}

/** Totali previsti nei prossimi N giorni (incluso lo scaduto da regolare) */
export function previstoEntro(flussi: Flusso[], giorni: number): { entrate: number; uscite: number } {
  const limite = format(addDays(new Date(), giorni), "yyyy-MM-dd");
  const sel = flussi.filter((f) => !f.realizzato && f.data <= limite);
  return {
    entrate: round2(sel.filter((f) => f.importo > 0).reduce((t, f) => t + f.importo, 0)),
    uscite: round2(-sel.filter((f) => f.importo < 0).reduce((t, f) => t + f.importo, 0)),
  };
}

/** Primo giorno in cui la liquidità prevista diventa negativa (entro l'orizzonte) */
export function primaTensione(flussi: Flusso[], liquidita: number, giorni = 180): { data: string; saldo: number } | null {
  const limite = format(addDays(new Date(), giorni), "yyyy-MM-dd");
  const futuri = flussi.filter((f) => !f.realizzato && f.data <= limite).sort((a, b) => a.data.localeCompare(b.data));
  let saldo = liquidita;
  for (const f of futuri) {
    saldo += f.importo;
    if (saldo < 0) return { data: f.data, saldo: round2(saldo) };
  }
  return null;
}
