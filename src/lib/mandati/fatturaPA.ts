// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
// Codice dal kit "Mandati di pagamento" (docs/mandati/riferimento), collaudato: non cambiarne i risultati.
// Rispetto all'originale: tipi espliciti della FatturaPA al posto di `any` ed estrazione dei file .xml.p7m.
/**
 * Lettura fattura elettronica FatturaPA/FPR12 (XML SdI) -> SchedaMandato.
 * Funziona nel browser e in una Supabase Edge Function (Deno): usa solo fast-xml-parser.
 */
import { XMLParser } from 'fast-xml-parser';
import type { SchedaMandato, VoceMandato } from './tipi';
import { r2 } from './importoInLettere';

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,                 // p:FatturaElettronica -> FatturaElettronica
  parseTagValue: false,                 // tiene i valori come stringhe (CAP, IBAN, codici)
  isArray: (name) => ['FatturaElettronicaBody', 'DettaglioLinee', 'DatiRiepilogo', 'DatiRitenuta',
    'DatiCassaPrevidenziale', 'DettaglioPagamento', 'DatiPagamento', 'DatiOrdineAcquisto', 'DatiContratto',
    'DatiConvenzione', 'Causale'].includes(name),
});

// ─── Struttura della FatturaPA (solo i campi letti) ─────────────────
type Lista<T> = T | T[] | undefined;
interface Linea { Descrizione?: string; PrezzoTotale?: string }
interface Cassa { TipoCassa?: string; AlCassa?: string; ImportoContributoCassa?: string }
interface Riepilogo { ImponibileImporto?: string; Imposta?: string; AliquotaIVA?: string; EsigibilitaIVA?: string; Natura?: string; RiferimentoNormativo?: string }
interface Ritenuta { TipoRitenuta?: string; ImportoRitenuta?: string; AliquotaRitenuta?: string }
interface DettaglioPag { IBAN?: string; IstitutoFinanziario?: string; ABI?: string; CAB?: string; BIC?: string; ImportoPagamento?: string }
interface RifDocumento { CodiceCUP?: string; CodiceCIG?: string }
interface Corpo {
  DatiGenerali: {
    DatiGeneraliDocumento: {
      TipoDocumento?: string; Data?: string; Numero?: string; ImportoTotaleDocumento?: string;
      Causale?: Lista<string>; DatiBollo?: { ImportoBollo?: string };
      DatiCassaPrevidenziale?: Lista<Cassa>; DatiRitenuta?: Lista<Ritenuta>;
    };
    DatiOrdineAcquisto?: Lista<RifDocumento>; DatiContratto?: Lista<RifDocumento>; DatiConvenzione?: Lista<RifDocumento>;
  };
  DatiBeniServizi: { DettaglioLinee?: Lista<Linea>; DatiRiepilogo?: Lista<Riepilogo> };
  DatiPagamento?: Lista<{ DettaglioPagamento?: Lista<DettaglioPag> }>;
}
interface Fattura {
  FatturaElettronica?: {
    FatturaElettronicaHeader: {
      CedentePrestatore: {
        DatiAnagrafici: {
          IdFiscaleIVA?: { IdCodice?: string }; CodiceFiscale?: string;
          Anagrafica: { Denominazione?: string; Nome?: string; Cognome?: string };
        };
        Sede?: { Indirizzo?: string; NumeroCivico?: string; CAP?: string; Comune?: string; Provincia?: string };
      };
    };
    FatturaElettronicaBody: Lista<Corpo>;
  };
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? 0 : Number(String(v).replace(',', '.')));
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const TIPI_CASSA: Record<string, string> = {
  TC01: 'Cassa Avvocati', TC02: 'Cassa Dottori Commercialisti', TC03: 'Cassa Geometri',
  TC04: 'Cassa Ingegneri e Architetti (Inarcassa)', TC05: 'Cassa Notariato', TC06: 'Cassa Ragionieri',
  TC22: 'INPS (rivalsa 4%)',
};
const TIPI_RIT: Record<string, string> = {
  RT01: "Ritenuta d'acconto persone fisiche", RT02: "Ritenuta d'acconto persone giuridiche",
  RT03: 'Contributo INPS', RT04: 'Contributo ENASARCO', RT05: 'Contributo ENPAM', RT06: 'Altro contributo previdenziale',
};

/** Una fattura può contenere più corpi (lotto): si restituisce una scheda per ciascun corpo. */
export function fatturaPAtoSchede(xml: string, cupDefault?: string): SchedaMandato[] {
  const j = parser.parse(xml) as Fattura;
  const fe = j.FatturaElettronica;
  if (!fe) throw new Error('Il file non è una FatturaPA valida (manca FatturaElettronica)');
  const ced = fe.FatturaElettronicaHeader.CedentePrestatore;
  const ana = ced.DatiAnagrafici;
  const nome = ana.Anagrafica.Denominazione ?? [ana.Anagrafica.Nome, ana.Anagrafica.Cognome].filter(Boolean).join(' ');
  const piva = ana.IdFiscaleIVA ? `${ana.IdFiscaleIVA.IdCodice}` : undefined;
  const cf = ana.CodiceFiscale;
  const sd = ced.Sede ?? {};
  const indirizzo = [`${sd.Indirizzo ?? ''} ${sd.NumeroCivico ?? ''}`.trim(), `${sd.CAP ?? ''} ${sd.Comune ?? ''}${sd.Provincia ? ` (${sd.Provincia})` : ''}`.trim()]
    .filter(Boolean).join(' - ');

  return arr(fe.FatturaElettronicaBody).map((body): SchedaMandato => {
    const dg = body.DatiGenerali.DatiGeneraliDocumento;
    const note: string[] = [];
    const voci: VoceMandato[] = [];

    // righe di dettaglio
    for (const l of arr(body.DatiBeniServizi.DettaglioLinee)) {
      voci.push({ voce: String(l.Descrizione).trim(), importo: r2(num(l.PrezzoTotale)) });
    }
    // cassa previdenziale
    let cassa = 0;
    for (const c of arr(dg.DatiCassaPrevidenziale)) {
      cassa += num(c.ImportoContributoCassa);
      voci.push({ voce: `Contributo integrativo ${TIPI_CASSA[c.TipoCassa ?? ''] ?? c.TipoCassa} ${num(c.AlCassa)}%`, importo: r2(num(c.ImportoContributoCassa)) });
    }
    void cassa;
    // riepilogo IVA
    let imponibile = 0, iva = 0, splitPayment = false;
    for (const r of arr(body.DatiBeniServizi.DatiRiepilogo)) {
      imponibile += num(r.ImponibileImporto); iva += num(r.Imposta);
      if (r.EsigibilitaIVA === 'S') splitPayment = true;
      if (num(r.Imposta)) {
        const es = r.EsigibilitaIVA === 'S' ? 'scissione dei pagamenti' : r.EsigibilitaIVA === 'D' ? 'esigibilità differita' : 'esigibilità immediata';
        voci.push({ voce: `IVA ${num(r.AliquotaIVA)}% (${es})`, importo: r2(num(r.Imposta)) });
      } else if (r.Natura) {
        voci.push({ voce: `Operazione non imponibile/esente - natura ${r.Natura}${r.RiferimentoNormativo ? ` (${r.RiferimentoNormativo})` : ''}`, importo: 0 });
      }
    }
    const bollo = num(dg.DatiBollo?.ImportoBollo);
    if (bollo) voci.push({ voce: 'Imposta di bollo', importo: r2(bollo) });

    const totale = dg.ImportoTotaleDocumento !== undefined ? num(dg.ImportoTotaleDocumento) : r2(imponibile + iva + bollo);
    if (dg.ImportoTotaleDocumento === undefined) note.push('ImportoTotaleDocumento assente in fattura: totale ricalcolato da riepilogo IVA.');
    else if (Math.abs(totale - r2(imponibile + iva + bollo)) > 0.01)
      note.push(`Totale documento (${totale.toFixed(2)}) diverso da imponibile+IVA+bollo (${r2(imponibile + iva + bollo).toFixed(2)}): verificare.`);
    voci.push({ voce: 'Totale documento', importo: r2(totale), grassetto: true });

    // ritenute
    let ritenute = 0;
    for (const rt of arr(dg.DatiRitenuta)) {
      const imp = num(rt.ImportoRitenuta); ritenute += imp;
      voci.push({ voce: `${TIPI_RIT[rt.TipoRitenuta ?? ''] ?? 'Ritenuta'} ${num(rt.AliquotaRitenuta)}% (da versare con F24)`, importo: -r2(imp) });
    }
    if (splitPayment) {
      voci.push({ voce: 'IVA in scissione dei pagamenti (da versare con F24)', importo: -r2(iva) });
      note.push('Fattura in split payment: verificare che il GAL sia soggetto alla scissione dei pagamenti.');
    }
    const netto = r2(totale - ritenute - (splitPayment ? iva : 0));

    // pagamento
    const pag = arr(body.DatiPagamento).flatMap((p) => arr(p.DettaglioPagamento));
    const p0: DettaglioPag = pag[0] ?? {};
    if (!p0.IBAN) note.push('IBAN del beneficiario non indicato in fattura.');
    const importoPag = pag.reduce((s, p) => s + num(p.ImportoPagamento), 0);
    if (pag.length && importoPag && Math.abs(importoPag - netto) > 0.01)
      note.push(`Importo pagamento indicato in fattura (${importoPag.toFixed(2)}) diverso dal netto calcolato (${netto.toFixed(2)}).`);
    if (pag.length > 1) note.push(`La fattura prevede ${pag.length} rate/pagamenti: verificare se emettere più mandati.`);

    // CUP / CIG
    const rif = [...arr(body.DatiGenerali.DatiOrdineAcquisto), ...arr(body.DatiGenerali.DatiContratto), ...arr(body.DatiGenerali.DatiConvenzione)];
    const cup = rif.map((r) => r.CodiceCUP).find(Boolean);
    const cig = rif.map((r) => r.CodiceCIG).find(Boolean);
    if (!cup) note.push(cupDefault ? `CUP non indicato in fattura: usato il CUP di progetto ${cupDefault}.` : 'CUP non indicato in fattura.');
    if (!cig) note.push('CIG non indicato in fattura: verificare se dovuto per l\'affidamento.');

    const descr = arr(dg.Causale).join(' ').trim() || voci[0]?.voce || '';
    const dataIt = String(dg.Data).split('-').reverse().join('/');
    return {
      tipo_documento: 'fattura_xml',
      beneficiario_nome: nome, beneficiario_cf: cf, beneficiario_piva: piva, beneficiario_indirizzo: indirizzo,
      beneficiario_banca: [p0.IstitutoFinanziario, p0.ABI && `ABI ${p0.ABI}`, p0.CAB && `CAB ${p0.CAB}`, p0.BIC && `BIC ${p0.BIC}`].filter(Boolean).join(' - ') || undefined,
      beneficiario_iban: p0.IBAN, modalita: 'bonifico',
      numero_documento: String(dg.Numero), data_documento: String(dg.Data),
      titolo_importi: dg.TipoDocumento === 'TD06' ? 'Importi da parcella' : 'Importi da fattura',
      voci, totale_documento: r2(totale), ritenute: r2(ritenute), netto,
      causale: `Fattura n. ${dg.Numero} del ${dataIt} - ${descr}${cup || cupDefault ? ` - CUP ${cup ?? cupDefault}` : ''}`,
      cup: cup ?? cupDefault, cig, note,
    };
  });
}

/**
 * Testo XML da un file di fattura: XML semplice oppure firmato .xml.p7m (busta CMS/PKCS#7,
 * binaria DER o codificata in Base64). Dalla busta si estrae il blocco XML della fattura.
 */
export function testoXmlFattura(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (/<\??xml|<([\w-]+:)?FatturaElettronica[\s>]/.test(utf8.slice(0, 2000))) return utf8;
  let der = bytes;
  // .p7m in Base64 (anche con intestazioni -----BEGIN…)
  const b64 = utf8.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+=*$/.test(b64) && b64.length > 100) {
    const bin = atob(b64);
    der = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  // Il contenuto firmato è in chiaro nella busta: si cerca tra il primo "<?xml" (o tag radice)
  // e la chiusura di FatturaElettronica. Byte -> stringa 1:1 per non alterare gli offset.
  const latin = Array.from(der, (b) => String.fromCharCode(b)).join('');
  const fine = latin.search(/<\/([\w-]+:)?FatturaElettronica>/);
  if (fine < 0) throw new Error('Impossibile estrarre la fattura dal file firmato (.p7m)');
  const chiusura = latin.slice(fine).match(/^<\/([\w-]+:)?FatturaElettronica>/)![0];
  let inizio = latin.lastIndexOf('<?xml', fine);
  if (inizio < 0) inizio = latin.search(/<([\w-]+:)?FatturaElettronica[\s>]/);
  if (inizio < 0) throw new Error('Impossibile estrarre la fattura dal file firmato (.p7m)');
  const blocco = der.slice(inizio, fine + chiusura.length);
  return new TextDecoder('utf-8').decode(blocco);
}
