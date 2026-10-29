// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
// Codice dal kit "Mandati di pagamento" (docs/mandati/riferimento), collaudato: non cambiarne i risultati.
// Rispetto all'originale: la banca tesoriere del titolo ("alla …") viene dalle impostazioni ({ente_banca}),
// così il modello pubblicato non contiene dati di un ente.
/**
 * Generazione del mandato Word dal modello con segnaposto (docxtemplater + pizzip).
 * Gira nel browser o in una Supabase Edge Function. Il PDF si ottiene convertendo il DOCX
 * (vedi ISTRUZIONI_MANDATI.md, sezione PDF).
 */
import PizZip from 'pizzip';
import Docxtemplater from "docxtemplater";
import type { SchedaMandato, Ente } from './tipi';
import { formatoEuro, importoInLettere } from './importoInLettere';
import { formattaIban } from './controlli';

export interface DatiStampa {
  numero_ordine: string;      // "12/2026" - da numerazione automatica (modificabile)
  data_ordine: string;        // "29/10/2026"
  bozza: boolean;             // true -> piè di pagina "BOZZA - da verificare..."
}

/** Campi che, se vuoti, in stampa mostrano il segnaposto giallo "[...]" del fac-simile */
const CAMPI_CON_SEGNAPOSTO = ['data_ordine', 'numero_ordine', 'misura', 'beneficiario_indirizzo', 'beneficiario_banca',
  'beneficiario_iban', 'delibera_ammissione', 'delibera_autorizzazione'] as const;

export function datiModello(s: SchedaMandato, e: Ente, st: DatiStampa) {
  const dati = [s.beneficiario_cf && `C.F. ${s.beneficiario_cf}`, s.beneficiario_piva && `P.IVA ${s.beneficiario_piva}`].filter(Boolean).join(' - ');
  const f24 = s.modalita === 'f24';
  const out: Record<string, unknown> = {
    ente_nome: e.nome, ente_indirizzo: e.indirizzo, ente_cf: e.cf, ente_pec: e.pec, ente_iban: e.iban_addebito,
    ente_banca: e.banca_tesoriere || 'banca tesoriere',
    pratica: e.pratica, firma_sinistra: e.firma_sinistra, firma_destra: e.firma_destra,
    data_ordine: st.data_ordine, numero_ordine: st.numero_ordine, misura: s.misura,
    operazione: s.operazione || 'SRG06', codice_progetto: s.codice_progetto || `Provvedimento Aiuti n. ${e.pratica}`,
    beneficiario_nome: s.beneficiario_nome, beneficiario_dati: dati ? ` - ${dati}` : '',
    beneficiario_indirizzo: s.beneficiario_indirizzo,
    beneficiario_banca: f24 ? `${e.banca_tesoriere} (addebito su conto ${e.nome})` : s.beneficiario_banca,
    etichetta_iban: f24 ? 'Modalità' : 'IBAN beneficiario',
    beneficiario_iban: f24 ? 'Non applicabile - modello F24' : (s.beneficiario_iban ? formattaIban(s.beneficiario_iban) : ''),
    titolo_importi: s.titolo_importi,
    voci: s.voci.map((v) => ({ voce: v.voce, importo: formatoEuro(v.importo), grassetto: !!v.grassetto })),
    netto_cifre: formatoEuro(s.netto), netto_lettere: importoInLettere(s.netto),
    causale: s.causale,
    delibera_ammissione: s.delibera_ammissione, delibera_autorizzazione: s.delibera_autorizzazione,
    ha_note: s.note.length > 0, note: s.note,
    rif_piede: s.numero_documento ? `Doc. n. ${s.numero_documento}` : s.beneficiario_nome,
    dicitura_stato: st.bozza ? 'BOZZA - da verificare prima della firma, pubblicazione o trasmissione' : '',
  };
  for (const k of CAMPI_CON_SEGNAPOSTO) {
    out[k] = (out[k] as string | undefined) ?? '';
    out[`vuoto_${k}`] = !out[k];
  }
  return out;
}

/** modello: bytes di modello_mandato.docx ; restituisce i bytes del DOCX compilato */
export function generaMandatoDocx(modello: Uint8Array | ArrayBuffer, s: SchedaMandato, e: Ente, st: DatiStampa): Uint8Array {
  const zip = new PizZip(modello);
  if (e.logo_png) adattaLogo(zip, e.logo_png);   // logo dalle impostazioni dell'ente
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  doc.render(datiModello(s, e, st));
  return doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Sostituisce il logo nell'intestazione mantenendo l'altezza (2 cm) e adattando la larghezza alle proporzioni del PNG. */
function adattaLogo(zip: PizZip, png: Uint8Array) {
  zip.file('word/media/logo_gal.png', png);
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) throw new Error('Il logo deve essere un file PNG');
  const w = dv.getUint32(16), h = dv.getUint32(20);          // IHDR
  const head = zip.file('word/header1.xml')!.asText();
  const cy = 720000;                                         // 2,0 cm in EMU
  const cx = Math.round(cy * w / h);
  zip.file('word/header1.xml', head.replace(/(<wp:extent cx=")\d+(" cy=")\d+(")/, `$1${cx}$2${cy}$3`)
                                    .replace(/(<a:ext cx=")\d+(" cy=")\d+(")/, `$1${cx}$2${cy}$3`));
}
