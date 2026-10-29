// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
// Codice dal kit "Mandati di pagamento" (docs/mandati/riferimento), collaudato: non cambiarne i risultati.
/** Modello dati unico del mandato: qualunque documento (fattura XML, PDF, busta paga, distinta)
 *  viene prima trasformato in una SchedaMandato, che l'utente verifica e poi si stampa. */

export type TipoDocumento = 'fattura_xml' | 'fattura_pdf' | 'busta_paga_pdf' | 'distinta_compenso' | 'f24' | 'altro';

export interface VoceMandato {
  voce: string;          // descrizione riga
  importo: number;       // in euro, negativo per trattenute (es. ritenuta d'acconto)
  grassetto?: boolean;   // righe di totale
}

export interface SchedaMandato {
  tipo_documento: TipoDocumento;
  documento_id?: string;          // id del documento importato nel gestionale
  // beneficiario
  beneficiario_nome: string;
  beneficiario_cf?: string;
  beneficiario_piva?: string;
  beneficiario_indirizzo?: string;
  beneficiario_banca?: string;
  beneficiario_iban?: string;     // senza spazi in DB; formattato in stampa
  modalita?: 'bonifico' | 'f24';
  // documento
  numero_documento?: string;
  data_documento?: string;        // ISO yyyy-mm-dd
  titolo_importi: string;         // "Importi da fattura" | "Importi da cedolino" | ...
  voci: VoceMandato[];
  totale_documento?: number;
  ritenute?: number;              // somma ritenute (positiva)
  netto: number;                  // importo del bonifico
  causale: string;
  cup?: string;
  cig?: string;
  // riferimenti GAL
  operazione?: string;            // es. SRG06
  codice_progetto?: string;       // es. Provvedimento Aiuti n. SRG06X-00
  misura?: string;
  delibera_ammissione?: string;
  delibera_autorizzazione?: string;
  note: string[];                 // anomalie/controlli -> stampate in rosso "DA VERIFICARE"
}

export interface Ente {               // tabella impostazioni ente (multi-GAL)
  nome: string;                       // "G.A.L. Nome del GAL"
  indirizzo: string;                  // "Via Roma 1 - 00100 Città (XX)"
  cf: string;                         // codice fiscale del GAL
  pec: string;
  iban_addebito: string;              // c/c del GAL
  banca_tesoriere: string;            // banca tesoriere del GAL
  pratica: string;                    // "SRG06X-00"
  firma_sinistra: string;             // "Il Presidente (Nome Cognome)"
  firma_destra: string;               // "Il RAF (Nome Cognome)"
  logo_png?: Uint8Array;              // logo caricato dalle impostazioni (PNG)
}
