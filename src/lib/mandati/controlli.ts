// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
// Codice dal kit "Mandati di pagamento" (docs/mandati/riferimento), collaudato: non cambiarne i risultati.
/** Controlli formali sulla scheda prima della stampa. Ogni esito negativo diventa una nota rossa. */
import type { SchedaMandato } from './tipi';
import { r2 } from './importoInLettere';

/** Verifica IBAN con algoritmo mod-97 (ISO 13616) */
export function ibanValido(iban?: string): boolean {
  if (!iban) return false;
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  if (s.startsWith('IT') && s.length !== 27) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const ch of r) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}

/** "IT60X0542811101000000123456" -> "IT60 X 05428 11101 000000123456" (stile mandati GAL; IBAN di esempio) */
export function formattaIban(iban: string): string {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (s.startsWith('IT') && s.length === 27) return `${s.slice(0, 4)} ${s[4]} ${s.slice(5, 10)} ${s.slice(10, 15)} ${s.slice(15)}`;
  return s.replace(/(.{4})/g, '$1 ').trim();
}

export function controllaScheda(s: SchedaMandato): string[] {
  const out: string[] = [];
  if (s.modalita !== 'f24') {
    if (!s.beneficiario_iban) out.push('IBAN beneficiario mancante.');
    else if (!ibanValido(s.beneficiario_iban)) out.push('IBAN beneficiario formalmente non valido (controllo mod-97).');
  }
  if (!(s.netto > 0)) out.push('Netto a pagare nullo o negativo.');
  const somma = r2(s.voci.filter((v) => !v.grassetto).reduce((a, v) => a + v.importo, 0));
  const tot = s.voci.find((v) => v.voce.toLowerCase().startsWith('totale documento'));
  if (!tot && Math.abs(somma - s.netto) > 0.01) out.push(`La somma delle voci (${somma.toFixed(2)}) non coincide con il netto (${s.netto.toFixed(2)}).`);
  if (!s.cup) out.push('CUP non indicato.');
  if (!s.delibera_ammissione || !s.delibera_autorizzazione) out.push('Estremi delle delibere CDA da completare.');
  return out;
}
