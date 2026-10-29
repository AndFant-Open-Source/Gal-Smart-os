// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
// Collaudo del modulo mandati (dal kit docs/mandati/riferimento/test_riferimento.ts): `npm run test:mandati`
// Oltre ai valori attesi, confronta i Word generati con quelli prodotti dal codice del kit.
import { readFileSync, existsSync, mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { importoInLettere, formatoEuro } from "../src/lib/mandati/importoInLettere";
import { fatturaPAtoSchede, testoXmlFattura } from "../src/lib/mandati/fatturaPA";
import { calcolaCompenso, schedaNettoCompenso, schedaF24Compenso } from "../src/lib/mandati/compensi";
import { ibanValido, controllaScheda } from "../src/lib/mandati/controlli";
import { generaMandatoDocx } from "../src/lib/mandati/generaMandato";
import type { Ente } from "../src/lib/mandati/tipi";
import { scadenzaF24 } from "../src/lib/scadenze";

const KIT = new URL("../docs/mandati/", import.meta.url);
const kit = (p: string) => new URL(p, KIT);
const MODELLO = new URL("../public/modelli/modello_mandato.docx", import.meta.url);

// Scadenza F24 (non richiede il kit): 16 del mese dopo, agosto al 20, festivi e fine settimana slittano
{
  const casi: [string, string][] = [["2026-10-29", "2026-11-16"], ["2026-07-10", "2026-08-20"],
    ["2028-03-10", "2028-04-18"], ["2027-04-02", "2027-05-17"]];
  for (const [pag, atteso] of casi) {
    if (scadenzaF24(pag) !== atteso) { console.log(`KO scadenza F24 per pagamento ${pag}: ${scadenzaF24(pag)} atteso ${atteso}`); process.exit(1); }
  }
  console.log("Scadenze F24 (festività comprese): ok");
}

if (!existsSync(kit("esempi/attesi_compensi_ott_2026.json")) || !existsSync(kit("ente_collaudo.json"))) {
  // Il kit (con dati reali) resta fuori dal repository pubblico: senza kit il collaudo si salta
  console.log("Kit docs/mandati non presente: collaudo dei mandati saltato");
  process.exit(0);
}

let ko = 0;
const eq = (nome: string, a: unknown, b: unknown) => { if (a !== b) { ko++; console.log(`KO ${nome}: ottenuto ${a} atteso ${b}`); } };

const attesi = JSON.parse(readFileSync(kit("esempi/attesi_compensi_ott_2026.json"), "utf8"));
for (const [v, t] of Object.entries<string>(attesi.lettere_extra)) eq(`lettere ${v}`, importoInLettere(Number(v)), t);

// Dati dell'ente usati per i mandati di esempio del kit (nel kit, fuori dal repository)
const { cup_progetto: CUP, ...ente }: Ente & { cup_progetto: string } = JSON.parse(readFileSync(kit("ente_collaudo.json"), "utf8"));
const modello = readFileSync(MODELLO);
// Il modello pubblicato è quello del kit reso neutro (logo segnaposto, banca dalle impostazioni):
// il testo dei mandati generati deve comunque coincidere con quello del kit.
const uscita = mkdtempSync(join(tmpdir(), "mandati-"));
let n = 1;
let confrontati = 0;

/** Il testo del documento generato deve coincidere con quello del kit (stesso nome file) */
function salvaEConfronta(nome: string, docx: Uint8Array) {
  writeFileSync(join(uscita, nome), docx);
  const rif = kit(`esempi/output_test/${nome}`);
  if (!existsSync(rif)) return;
  const xml = (b: Uint8Array) => new PizZip(b).file("word/document.xml")!.asText();
  eq(`Word identico al kit: ${nome}`, xml(docx) === xml(readFileSync(rif)), true);
  confrontati++;
}

// 1) fattura XML
// Fattura di collaudo e mandato atteso: i nomi dei file del kit contengono il fornitore
const nomeXml = readdirSync(kit("esempi/")).find((n) => /^fattura_test_.*\.xml$/.test(n))!;
const nomeDocxFattura = readdirSync(kit("esempi/output_test/")).find((n) => /^01_fattura_.*\.docx$/.test(n))!;
const xmlFattura = readFileSync(kit(`esempi/${nomeXml}`), "utf8");
const [f] = fatturaPAtoSchede(xmlFattura, CUP);
eq("fattura netto", f.netto, 3206.4); eq("fattura beneficiario letto", f.beneficiario_nome.length > 0, true);
eq("fattura lettere", importoInLettere(f.netto), "Tremiladuecentosei/40");
eq("IBAN valido", ibanValido(f.beneficiario_iban), true);
f.note.push(...controllaScheda(f));
salvaEConfronta(nomeDocxFattura,
  generaMandatoDocx(modello, f, ente, { numero_ordine: `${n++}/2026`, data_ordine: "29/10/2026", bozza: true }));

// 2) compensi
for (const c of attesi.casi) {
  const d = { nome: c.nome, ruolo: c.ruolo, periodo: "ottobre 2026", lordo: c.lordo, aliquota_gs: 0.24, irpef: c.irpef,
              cup: CUP, rif_distinta: "Distinta di calcolo del 27/10/2026" };
  const r = calcolaCompenso(d) as Record<string, unknown>;
  for (const k of ["inps_tot", "inps_perc", "inps_gal", "netto", "f24"]) eq(`${c.nome} ${k}`, r[k], c.atteso[k]);
  eq(`${c.nome} lettere`, importoInLettere(r.netto as number), c.atteso.lettere);
  const s1 = schedaNettoCompenso(d); s1.note.push(...controllaScheda(s1));
  const s2 = schedaF24Compenso(d, ente.cf, "16/11/2026");
  for (const s of [s1, s2]) {
    const slug = c.nome.replace(/ /g, "_") + (s.modalita === "f24" ? "_F24" : "_netto");
    salvaEConfronta(`${String(n).padStart(2, "0")}_${slug}.docx`,
      generaMandatoDocx(modello, s, ente, { numero_ordine: `${n++}/2026`, data_ordine: "29/10/2026", bozza: true }));
  }
}

// 3) fattura firmata .xml.p7m (busta binaria e Base64): stessa scheda dell'XML
const busta = Buffer.concat([Buffer.from([0x30, 0x80, 0x06, 0x09, 0x2a, 0x86, 0x48]), Buffer.from(xmlFattura, "utf8"), Buffer.from([0x00, 0x00, 0xa0, 0x82])]);
for (const [nome, bytes] of [["p7m binario", busta], ["p7m base64", Buffer.from(busta.toString("base64"))]] as const) {
  const [p] = fatturaPAtoSchede(testoXmlFattura(new Uint8Array(bytes)), CUP);
  eq(`${nome}: netto`, p.netto, 3206.4);
}
eq("XML semplice riconosciuto", testoXmlFattura(new Uint8Array(Buffer.from(xmlFattura))), xmlFattura);

console.log(`Word confrontati con il kit: ${confrontati}`);
console.log(ko === 0 ? `TUTTI I TEST OK (${n - 1} mandati generati in ${uscita})` : `${ko} TEST FALLITI`);
console.log("formatoEuro", formatoEuro(3206.4), formatoEuro(-600), formatoEuro(1309.03));
process.exit(ko ? 1 : 0);
