// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
// ─── Auth & Users ────────────────────────────────────────────────
export type UserRole = "admin" | "operatore" | "lettore";

export interface Profilo {
  id: string;
  nome_completo: string;
  email: string | null;
  ruolo: UserRole;
  funzione?: Funzione | null;
  attivo: boolean;
  created_at: string;
  updated_at: string;
}

// ─── GAL ─────────────────────────────────────────────────────────
export interface Gal {
  id: string;
  nome: string;
  codice: string | null;
  codice_fiscale: string | null;
  partita_iva: string | null;
  regione: string | null;
  indirizzo: string | null;
  email: string | null;
  pec: string | null;
  telefono: string | null;
  sito_web: string | null;
  attivo: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Bandi ───────────────────────────────────────────────────────
export type StatoBando = "bozza" | "aperto" | "chiuso" | "archiviato";

export interface Bando {
  id: string;
  gal_id: string;
  numero: string;
  tipologia_operazione: string | null;
  titolo: string;
  descrizione: string | null;
  dotazione_finanziaria: number;
  stato: StatoBando;
  data_apertura: string | null;
  data_chiusura: string | null;
  created_at: string;
  updated_at: string;
  // join
  num_domande?: number;
}

export type StatoSchemaBando = "in_corso" | "pubblicato" | "sospeso" | "annullato";
export type StatoFaseSchema = "da_fare" | "in_corso" | "completata" | "non_applicabile";

export interface SchemaBando {
  id: string;
  gal_id: string;
  intervento: string;
  sottointervento: string | null;
  azione: string | null;
  titolo: string;
  descrizione: string | null;
  dotazione_finanziaria: number;
  de_minimis: boolean;
  stato: StatoSchemaBando;
  bando_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FaseSchemaBando {
  id: string;
  gal_id: string;
  schema_id: string;
  numero: number;
  titolo: string;
  soggetto: string | null;
  canale: string | null;
  stato: StatoFaseSchema;
  data_avvio: string | null;
  data_completamento: string | null;
  riferimento: string | null;
  note: string | null;
  completata_da: string | null;
  created_at: string;
  updated_at: string;
}

export type StatoDomanda =
  | "presentata"
  | "istruttoria"
  | "ammessa"
  | "finanziata"
  | "non_ammessa"
  | "rinunciata"
  | "liquidata";

export interface DomandaSostegno {
  id: string;
  gal_id: string;
  bando_id: string;
  codice_agea_ds: string | null;
  denominazione: string;
  cuaa: string | null;
  comune: string | null;
  provincia: string | null;
  stato: StatoDomanda;
  spesa_pubblica_ammissibile: number;
  contributo_concesso: number;
  posizione_graduatoria: number | null;
  data_presentazione: string | null;
  data_concessione: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  // join
  bando?: { titolo: string; numero: string };
}

export interface PagamentoBando {
  id: string;
  gal_id: string;
  domanda_id: string;
  tipo: "acconto" | "sal" | "saldo";
  importo: number;
  data_pagamento: string | null;
  note: string | null;
  created_at: string;
}

// ─── Organi Sociali ───────────────────────────────────────────────
export type TipoSocio = "Ente Pubblico" | "Privato" | "Associazione" | "Altro";

export interface Socio {
  id: string;
  gal_id: string;
  codice_socio: string | null;
  tipo_socio: TipoSocio;
  denominazione: string;
  codice_fiscale: string | null;
  partita_iva: string | null;
  comune: string | null;
  provincia: string | null;
  indirizzo: string | null;
  email: string | null;
  pec: string | null;
  telefono: string | null;
  rappresentante_legale: string | null;
  quota_partecipazione: number;
  data_adesione: string | null;
  data_recesso: string | null;
  attivo: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotaSociale {
  id: string;
  gal_id: string;
  socio_id: string;
  anno: number;
  quota: number;
  data_versamento: string | null;
  note: string | null;
  created_at: string;
  socio?: { denominazione: string; codice_socio: string | null };
}

export interface Organo {
  id: string;
  gal_id: string;
  nome: string;
  tipo: string | null;
  created_at: string;
}

export interface Componente {
  id: string;
  gal_id: string;
  organo_id: string | null;
  nome: string;
  cognome: string | null;
  ruolo: string | null;
  email: string | null;
  data_nomina: string | null;
  data_fine_mandato: string | null;
  attivo: boolean;
  created_at: string;
  organo?: { nome: string };
}

export interface Seduta {
  id: string;
  gal_id: string;
  organo_id: string | null;
  numero: number | null;
  data_seduta: string;
  luogo: string | null;
  tipo: "ordinaria" | "straordinaria" | null;
  quorum_presente: number | null;
  stato: "convocata" | "tenuta" | "deserta";
  verbale_url: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  organo?: { nome: string };
  num_delibere?: number;
}

export interface Delibera {
  id: string;
  gal_id: string;
  seduta_id: string | null;
  numero: string;
  anno: number | null;
  oggetto: string;
  testo: string | null;
  esito: "approvata" | "respinta" | "ritirata" | null;
  data_delibera: string | null;
  allegato_url: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  seduta?: { data_seduta: string; numero: number | null };
}

// ─── Lookup categorie previsione ─────────────────────────────────
export interface Intervento {
  id: string;
  gal_id: string;
  nome: string;
  created_at: string;
}

export interface TipologiaSpesa {
  id: string;
  gal_id: string;
  intervento_id: string;
  nome: string;
  created_at: string;
}

export interface CapitoloLookup {
  id: string;
  gal_id: string;
  tipologia_id: string;
  nome: string;
  created_at: string;
}

// ─── Rendicontazione ──────────────────────────────────────────────
export interface Fornitore {
  id: string;
  gal_id: string;
  denominazione: string;
  partita_iva: string | null;
  codice_fiscale: string | null;
  indirizzo: string | null;
  comune: string | null;
  provincia: string | null;
  email: string | null;
  pec: string | null;
  iban: string | null;
  telefono: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface VocePrevisione {
  id: string;
  gal_id: string;
  periodo_id: string | null;
  intervento: string;
  tipologia_spesa: string;
  voce: string;
  capitolo: string;
  unita_misura: string | null;
  quantita: number;
  costo_unitario: number;
  spesa_imponibile: number;
  importo_iva: number;
  spesa_con_iva: number;
  iva_applicabile: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
  periodo?: { nome: string };
}

export interface Periodo {
  id: string;
  gal_id: string;
  codice: string;
  descrizione: string;
  data_inizio: string | null;
  data_fine: string | null;
  anno_riferimento: number | null;
  misura: string | null;
  sotto_misura: string | null;
  stato: string;
  perc_feasr: number;
  note: string | null;
  created_at: string;
}

export type StatoGiustificativo =
  | "da_pagare"
  | "pagata"
  | "parzialmente_pagata"
  | "annullata";

export type TipoDoc =
  | "fattura"
  | "fattura_elettronica"
  | "nota_credito"
  | "ricevuta"
  | "busta_paga"
  | "f24"
  | "altro";

export interface Giustificativo {
  id: string;
  gal_id: string;
  fornitore_id: string | null;
  numero_doc: string;
  data_doc: string;
  tipo_doc: TipoDoc;
  fornitore_denominazione: string | null;
  fornitore_piva: string | null;
  imponibile: number;
  iva: number;
  aliquota_iva: number;
  totale: number;
  cig: string | null;
  cup: string | null;
  intervento: string | null;
  tipologia_spesa: string | null;
  capitolo: string | null;
  procedura_id: string | null;
  stato: StatoGiustificativo;
  note: string | null;
  created_at: string;
  updated_at: string;
  fornitore?: { denominazione: string };
  procedura?: { codice: string; oggetto: string };
}

export type TipoDocumentoGiustificativo =
  | "xml"
  | "fattura_cartacea"
  | "mandato_pagamento"
  | "bonifico"
  | "f24"
  | "altro";

export interface DocumentoGiustificativo {
  id: string;
  gal_id: string;
  giustificativo_id: string;
  tipo: TipoDocumentoGiustificativo;
  nome_file: string;
  storage_path: string;
  dimensione: number | null;
  note: string | null;
  created_at: string;
}

export interface PagamentoGiustificativo {
  id: string;
  gal_id: string;
  giustificativo_id: string;
  data_pagamento: string;
  importo: number;
  modalita: string | null;
  riferimento: string | null;
  note: string | null;
  created_at: string;
}

export interface RigaImputazione {
  id: string;
  giustificativo_id: string;
  voce_previsione_id: string | null;
  periodo_id: string | null;
  misura: string;
  sotto_misura: string | null;
  categoria_spesa: string;
  intervento: string | null;
  tipologia_spesa: string | null;
  voce: string | null;
  capitolo: string | null;
  imponibile_imputato: number;
  iva_imputato: number;
  totale_imputato: number;
  imponibile_richiesto: number | null;
  iva_richiesta: number | null;
  totale_richiesto: number | null;
  eleggibile: boolean;
  tipo_acconto: string | null;
  note: string | null;
  created_at: string;
  periodo?: { codice: string; descrizione: string };
  voce_previsione?: { voce: string; capitolo: string | null };
}

// ─── Acquisti ─────────────────────────────────────────────────────
export type StatoProcedura =
  | "fabbisogno"
  | "determina"
  | "scelta_procedura"
  | "preventivi_inviti"
  | "affidamento"
  | "contratto"
  | "esecuzione"
  | "pagamenti"
  | "trasparenza"
  | "chiusa";

export interface Procedura {
  id: string;
  gal_id: string;
  codice: string | null;
  oggetto: string;
  tipo_procedura: string | null;
  importo_stimato: number;
  importo_aggiudicato: number | null;
  cig: string | null;
  cup: string | null;
  rup_nome: string | null;
  rup_email: string | null;
  fornitore_aggiudicatario: string | null;
  stato: StatoProcedura;
  pubblicato_anac: boolean;
  data_determina: string | null;
  data_affidamento: string | null;
  data_contratto: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProceduraInvitato {
  id: string;
  gal_id: string;
  procedura_id: string;
  denominazione: string;
  partita_iva: string | null;
  offerta_presentata: boolean;
  importo_offerta: number | null;
  note: string | null;
  created_at: string;
}

// ─── Contratti ───────────────────────────────────────────────────
export interface Contratto {
  id: string;
  gal_id: string;
  numero: string;
  oggetto: string;
  contraente: string;
  partita_iva: string | null;
  tipo_contratto: string | null;
  importo: number;
  data_stipula: string;
  data_inizio: string | null;
  data_fine: string | null;
  procedura_id: string | null;
  intervento: string | null;
  tipologia_spesa: string | null;
  capitolo: string | null;
  cig: string | null;
  cup: string | null;
  documento_path: string | null;
  documento_nome: string | null;
  stato: "attivo" | "scaduto" | "risolto" | "annullato";
  note: string | null;
  created_at: string;
  updated_at: string;
  procedura?: { codice: string; oggetto: string } | null;
}

// ─── Archivio: Registro di catalogazione ─────────────────────────
export interface Fascicolo {
  id: string;
  gal_id: string;
  numero_fascicolo: string;
  ragione_sociale: string;
  indirizzo: string | null;
  cap: string | null;
  comune: string | null;
  provincia: string | null;
  codice_fiscale: string | null;
  partita_iva: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Audit ────────────────────────────────────────────────────────
export interface AuditEvent {
  id: string;
  gal_id: string | null;
  user_id: string | null;
  username: string | null;
  azione: string;
  entita: string | null;
  entita_id: string | null;
  descrizione: string | null;
  created_at: string;
  gal?: { nome: string };
}

// ═════════════════════════════════════════════════════════════════
// GAL-OS 4.0 — Agenda scadenze, Scadenzario pagamenti, Cash flow
// ═════════════════════════════════════════════════════════════════

/** Funzione organizzativa: chi è responsabile della scadenza */
export type Funzione = "segreteria" | "direttore_tecnico" | "raf";

export type PrioritaPratica = "bassa" | "media" | "alta" | "urgente";
export type StatoPratica = "aperta" | "in_corso" | "sospesa" | "completata" | "annullata";
export type Ricorrenza = "nessuna" | "mensile" | "trimestrale" | "semestrale" | "annuale";

export interface PraticaAgenda {
  id: string;
  gal_id: string;
  codice: string | null;
  titolo: string;
  descrizione: string | null;
  categoria: string;
  responsabile: Funzione;
  priorita: PrioritaPratica;
  stato: StatoPratica;
  data_apertura: string;
  data_scadenza: string;
  data_promemoria: string | null;
  data_completamento: string | null;
  ricorrenza: Ricorrenza;
  riferimento: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  gal_id: string;
  pratica_id: string;
  descrizione: string;
  responsabile: Funzione | null;
  data_scadenza: string | null;
  completata: boolean;
  completata_il: string | null;
  completata_da: string | null;
  ordine: number;
  created_at: string;
  updated_at: string;
}

export interface NotaPratica {
  id: string;
  gal_id: string;
  pratica_id: string;
  testo: string;
  autore: string | null;
  created_at: string;
  updated_at: string;
}

export type TipoConto = "conto_corrente" | "conto_dedicato" | "cassa" | "carta";

export interface ContoCorrente {
  id: string;
  gal_id: string;
  nome: string;
  banca: string | null;
  iban: string | null;
  tipo: TipoConto;
  saldo_iniziale: number;
  data_saldo_iniziale: string;
  attivo: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export type TipoScadenzaPagamento =
  | "fattura" | "parcella" | "f24" | "stipendio" | "utenza" | "canone" | "rimborso" | "altro";
export type StatoScadenzaPagamento = "da_pagare" | "in_pagamento" | "pagata" | "annullata";
export type ModalitaPagamento = "bonifico" | "f24" | "rid" | "carta" | "contanti" | "altro";

export interface ScadenzaPagamento {
  id: string;
  gal_id: string;
  tipo: TipoScadenzaPagamento;
  fornitore_id: string | null;
  beneficiario: string;
  beneficiario_piva: string | null;
  beneficiario_cf: string | null;
  beneficiario_iban: string | null;
  descrizione: string;
  numero_documento: string | null;
  data_documento: string | null;
  imponibile: number;
  iva: number;
  split_payment: boolean;
  ritenuta: number;
  ritenuta_codice_tributo: string | null;
  totale_documento: number;
  importo_da_pagare: number;
  cup: string;
  cup_in_fattura: boolean;
  cig: string | null;
  cig_esente: boolean;
  cig_motivo_esenzione: string | null;
  cig_in_fattura: boolean;
  verifica_note: string | null;
  intervento: string | null;
  capitolo: string | null;
  giustificativo_id: string | null;
  data_scadenza: string;
  stato: StatoScadenzaPagamento;
  data_pagamento: string | null;
  conto_id: string | null;
  modalita_pagamento: ModalitaPagamento | null;
  cro_trn: string | null;
  importo_pagato: number | null;
  mandato_numero: string | null;
  mandato_data: string | null;
  fattura_path: string | null;
  fattura_nome: string | null;
  bonifico_path: string | null;
  bonifico_nome: string | null;
  scadenza_origine_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  conto?: Pick<ContoCorrente, "nome" | "banca" | "iban"> | null;
}

export type TipoMovimento = "entrata" | "uscita";
export type StatoMovimento = "previsto" | "realizzato" | "annullato";

export interface MovimentoCassa {
  id: string;
  gal_id: string;
  tipo: TipoMovimento;
  categoria: string;
  descrizione: string;
  controparte: string | null;
  importo: number;
  data_prevista: string;
  data_effettiva: string | null;
  stato: StatoMovimento;
  conto_id: string | null;
  riferimento: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Mandati di pagamento ────────────────────────────────────────
export type StatoMandato = "bozza" | "verificato" | "firmato" | "pagato" | "annullato";

export interface ImpostazioniMandati {
  id: string;
  gal_id: string;
  iban_addebito: string | null;
  banca_tesoriere: string | null;
  pratica: string | null;
  operazione: string | null;
  misura: string | null;
  cup: string | null;
  firma_sinistra: string | null;
  firma_destra: string | null;
  logo_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Mandato {
  id: string;
  gal_id: string;
  anno: number;
  numero: number;
  numero_manuale: boolean;
  data_ordine: string;
  stato: StatoMandato;
  tipo_documento: string;
  modalita: "bonifico" | "f24";
  scheda: import("../lib/mandati/tipi").SchedaMandato;
  netto: number;
  beneficiario_nome: string;
  beneficiario_piva: string | null;
  beneficiario_iban: string | null;
  numero_documento: string | null;
  cup: string | null;
  scadenza_id: string | null;
  giustificativo_id: string | null;
  mandato_collegato_id: string | null;
  docx_path: string | null;
  verificato_da: string | null;
  verificato_il: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
