// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
// Codice dal kit "Mandati di pagamento" (docs/mandati/riferimento), collaudato: non cambiarne i risultati.
/**
 * Importo in lettere secondo l'uso dei mandati GAL: "Tremiladuecentosei/40".
 * Porting 1:1 della funzione `lettere()` dello script Python originale (genera_mandati_gal.py).
 */
const U = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici',
  'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const D = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];

function sotto1000(n: number): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  let s = c === 0 ? '' : c === 1 ? 'cento' : U[c] + 'cento';
  let p: string;
  if (r < 20) {
    p = U[r];
  } else {
    const d = Math.floor(r / 10), u = r % 10;
    let dd = D[d];
    if (u === 1 || u === 8) dd = dd.slice(0, -1); // ventuno, ventotto
    p = dd + U[u];
  }
  if (c && s.endsWith('o') && p.startsWith('o')) s = s.slice(0, -1); // centottanta
  return s + p;
}

function interoInLettere(n: number): string {
  if (n === 0) return 'zero';
  const parti: string[] = [];
  const miliardi = Math.floor(n / 1e9), milioni = Math.floor((n % 1e9) / 1e6);
  const migliaia = Math.floor((n % 1e6) / 1000), resto = n % 1000;
  if (miliardi) parti.push(miliardi === 1 ? 'unmiliardo' : interoInLettere(miliardi) + 'miliardi');
  if (milioni) parti.push(milioni === 1 ? 'unmilione' : sotto1000(milioni) + 'milioni');
  if (migliaia) parti.push(migliaia === 1 ? 'mille' : sotto1000(migliaia) + 'mila');
  parti.push(sotto1000(resto));
  let t = parti.join('');
  if (t.endsWith('tre') && t.length > 3) t = t.slice(0, -3) + 'tré'; // ventitré, trecentotré
  return t;
}

/** Importo (euro, anche con decimali) -> "Milletrecentonove/03" */
export function importoInLettere(importo: number): string {
  const centesimiTot = Math.round(importo * 100);
  const euro = Math.floor(centesimiTot / 100);
  const cent = centesimiTot % 100;
  const t = interoInLettere(euro);
  return t.charAt(0).toUpperCase() + t.slice(1) + '/' + String(cent).padStart(2, '0');
}

/** 3206.4 -> "3.206,40" ; -600 -> "- 600,00" (formato usato nei mandati) */
export function formatoEuro(v: number): string {
  // formattazione manuale: identica in browser, Node e Deno (non dipende dai dati locali ICU)
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  return (v < 0 ? '- ' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
}

/** Arrotondamento contabile a 2 decimali (evita 0.1+0.2) */
export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
