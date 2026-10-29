// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
// Codice dal kit "Mandati di pagamento" (docs/mandati/riferimento), collaudato: non cambiarne i risultati.
/**
 * Regole di calcolo per distinte compensi Co.Co.Co./assimilati (gettoni CDA, commissioni, revisori)
 * e per buste paga: mandato del NETTO al percettore + mandato del relativo F24.
 * Stesse regole usate per i mandati di ottobre 2026 (vedi esempi/attesi_compensi_ott_2026.json).
 */
import type { SchedaMandato } from './tipi';
import { r2 } from './importoInLettere';

export interface DatiCompenso {
  nome: string; cf?: string; ruolo: string; periodo: string;      // es. "ottobre 2026"
  lordo: number;
  aliquota_gs: number;            // 0.24 se pensionato/iscritto ad altra cassa (causale C10), altrimenti piena (CXX)
  quota_percettore?: number;      // default 1/3
  irpef: number;                  // ritenuta IRPEF come da distinta/cedolino del consulente
  iban?: string; cup?: string; rif_distinta?: string;
}

export function calcolaCompenso(d: DatiCompenso) {
  const q = d.quota_percettore ?? 1 / 3;
  const inps_tot = r2(d.lordo * d.aliquota_gs);
  const inps_perc = r2(inps_tot * q);
  const inps_gal = r2(inps_tot - inps_perc);
  const netto = r2(d.lordo - inps_perc - d.irpef);
  return { inps_tot, inps_perc, inps_gal, netto, f24: r2(inps_tot + d.irpef), causale_inps: d.aliquota_gs <= 0.24 ? 'C10' : 'CXX' };
}

export function schedaNettoCompenso(d: DatiCompenso): SchedaMandato {
  const c = calcolaCompenso(d);
  return {
    tipo_documento: 'distinta_compenso', beneficiario_nome: d.nome, beneficiario_cf: d.cf, beneficiario_iban: d.iban, modalita: 'bonifico',
    titolo_importi: 'Importi da distinta di calcolo compenso',
    voci: [
      { voce: `Compenso lordo - ${d.ruolo} - ${d.periodo}`, importo: d.lordo },
      { voce: 'Contributo INPS Gestione Separata a carico del percipiente (1/3) - da versare con F24', importo: -c.inps_perc },
      { voce: 'Ritenuta IRPEF (da versare con F24)', importo: -d.irpef },
      { voce: 'Totale trattenute', importo: -r2(c.inps_perc + d.irpef), grassetto: true },
    ],
    ritenute: r2(c.inps_perc + d.irpef), netto: c.netto,
    causale: `${d.ruolo} - ${d.nome} - competenza ${d.periodo}${d.rif_distinta ? ` - ${d.rif_distinta}` : ''}${d.cup ? ` - CUP ${d.cup}` : ''}`,
    cup: d.cup, note: [],
  };
}

export function schedaF24Compenso(d: DatiCompenso, cfEnte: string, scadenza: string): SchedaMandato {
  const c = calcolaCompenso(d);
  const voci = [
    { voce: `INPS Gestione Separata - causale ${c.causale_inps} - quota percipiente (1/3)`, importo: c.inps_perc },
    { voce: `INPS Gestione Separata - causale ${c.causale_inps} - quota a carico GAL (2/3)`, importo: c.inps_gal },
  ];
  if (d.irpef) voci.push({ voce: 'Ritenuta IRPEF redditi assimilati - cod. tributo 1001', importo: d.irpef });
  return {
    tipo_documento: 'f24', modalita: 'f24',
    beneficiario_nome: 'Agenzia delle Entrate / INPS',
    beneficiario_cf: undefined, beneficiario_indirizzo: 'Versamento telematico F24',
    beneficiario_iban: undefined,
    titolo_importi: `Importi da versare (compenso ${d.periodo} ${d.nome})`,
    voci, netto: c.f24,
    causale: `Versamento contributi Gestione Separata INPS${d.irpef ? ' e ritenuta IRPEF' : ''} sul compenso di ${d.nome} - competenza ${d.periodo} - scadenza ${scadenza}${d.cup ? ` - CUP ${d.cup}` : ''}`,
    cup: d.cup, note: [`Contribuente F24: ente C.F. ${cfEnte}. Codici e importi da confermare con il consulente paghe.`],
  };
}

/** Scadenza F24: giorno 16 del mese successivo al pagamento (se festivo/sabato slitta al primo giorno lavorativo). */
export function scadenzaF24(dataPagamento: Date): Date {
  const d = new Date(dataPagamento.getFullYear(), dataPagamento.getMonth() + 1, 16);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); // festività nazionali: da gestire con calendario
  return d;
}
