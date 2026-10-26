// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";
import { addDays, format, parseISO } from "date-fns";
import { FileUp, Loader2, CheckCircle2, AlertTriangle, XCircle, FileCode2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { readFatturaXml } from "../../lib/fatturaPA";
import { calcolaNettoDaPagare, normalizzaCodice, verificaTracciabilita } from "../../lib/scadenze";
import { formatCurrency } from "../../lib/utils";
import {
  TIPO_SCADENZA_LABELS, CODICI_TRIBUTO_RITENUTA, MOTIVI_ESENZIONE_CIG,
} from "../../constants";
import type { Fornitore, TipoScadenzaPagamento } from "../../types";

export interface ScadenzaFormValues {
  tipo: TipoScadenzaPagamento;
  fornitore_id: string;
  beneficiario: string;
  beneficiario_piva: string;
  beneficiario_cf: string;
  beneficiario_iban: string;
  descrizione: string;
  numero_documento: string;
  data_documento: string;
  imponibile: number;
  iva: number;
  split_payment: boolean;
  ritenuta: number;
  ritenuta_codice_tributo: string;
  cup: string;
  cup_in_fattura: boolean;
  cig: string;
  cig_esente: boolean;
  cig_motivo_esenzione: string;
  cig_in_fattura: boolean;
  verifica_note: string;
  intervento: string;
  capitolo: string;
  data_scadenza: string;
  note: string;
}

export type ScadenzaSubmitValues = ScadenzaFormValues & { totale_documento: number; importo_da_pagare: number };

/** Campi da salvare su gal_scadenze_pagamento a partire dai valori del form */
export function payloadDaForm(v: ScadenzaSubmitValues) {
  return {
    tipo: v.tipo,
    fornitore_id: v.fornitore_id || null,
    beneficiario: v.beneficiario.trim(),
    beneficiario_piva: v.beneficiario_piva || null,
    beneficiario_cf: v.beneficiario_cf || null,
    beneficiario_iban: v.beneficiario_iban || null,
    descrizione: v.descrizione.trim(),
    numero_documento: v.numero_documento || null,
    data_documento: v.data_documento || null,
    imponibile: v.imponibile,
    iva: v.iva,
    split_payment: v.split_payment,
    ritenuta: v.ritenuta,
    ritenuta_codice_tributo: v.ritenuta > 0 ? v.ritenuta_codice_tributo || null : null,
    totale_documento: v.totale_documento,
    importo_da_pagare: v.importo_da_pagare,
    cup: v.cup,
    cup_in_fattura: v.cup_in_fattura,
    cig: v.cig || null,
    cig_esente: v.cig_esente,
    cig_motivo_esenzione: v.cig_esente ? v.cig_motivo_esenzione : null,
    cig_in_fattura: v.cig_in_fattura,
    verifica_note: v.verifica_note || null,
    intervento: v.intervento || null,
    capitolo: v.capitolo || null,
    data_scadenza: v.data_scadenza,
    note: v.note || null,
  };
}

export function scadenzaFormVuota(): ScadenzaFormValues {
  return {
    tipo: "fattura", fornitore_id: "", beneficiario: "", beneficiario_piva: "", beneficiario_cf: "",
    beneficiario_iban: "", descrizione: "", numero_documento: "", data_documento: "", imponibile: 0, iva: 0,
    split_payment: false, ritenuta: 0, ritenuta_codice_tributo: "", cup: "", cup_in_fattura: false, cig: "",
    cig_esente: false, cig_motivo_esenzione: "", cig_in_fattura: false, verifica_note: "", intervento: "",
    capitolo: "", data_scadenza: "", note: "",
  };
}

interface Props {
  galId: string;
  initial: ScadenzaFormValues;
  modalita: "crea" | "modifica";
  onSubmit: (v: ScadenzaSubmitValues, fattura: File | null) => Promise<void>;
  onCancel: () => void;
}

export default function ScadenzaForm({ galId, initial, modalita, onSubmit, onCancel }: Props) {
  const [v, setV] = useState<ScadenzaFormValues>(initial);
  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [interventi, setInterventi] = useState<string[]>([]);
  const [capitoli, setCapitoli] = useState<string[]>([]);
  const [fattura, setFattura] = useState<File | null>(null);
  const [codiciFattura, setCodiciFattura] = useState<{ cup: string; cig: string } | null>(null);
  const [leggendo, setLeggendo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [avvisiPresi, setAvvisiPresi] = useState(false);

  useEffect(() => {
    async function loadLookup() {
      const [fRes, iRes, cRes] = await Promise.all([
        supabase.from("gal_fornitori").select("*").eq("gal_id", galId).order("denominazione"),
        supabase.from("gal_interventi").select("nome").eq("gal_id", galId).order("nome"),
        supabase.from("gal_capitoli").select("nome").eq("gal_id", galId).order("nome"),
      ]);
      if (fRes.error) console.error(fRes.error);
      setFornitori((fRes.data ?? []) as Fornitore[]);
      setInterventi((iRes.data ?? []).map((r: { nome: string }) => r.nome));
      setCapitoli((cRes.data ?? []).map((r: { nome: string }) => r.nome));
    }
    loadLookup();
  }, [galId]);

  function set<K extends keyof ScadenzaFormValues>(k: K, val: ScadenzaFormValues[K]) {
    setV((p) => ({ ...p, [k]: val }));
  }

  const { totale, netto } = calcolaNettoDaPagare(v);

  const verifiche = useMemo(
    () => verificaTracciabilita({ cup: v.cup, cig: v.cig, cigEsente: v.cig_esente, codiciFattura }),
    [v.cup, v.cig, v.cig_esente, codiciFattura]
  );
  const erroriTracc = verifiche.filter((x) => x.livello === "errore");
  const avvisi = verifiche.filter((x) => x.livello === "avviso");

  const errori: string[] = [];
  if (!v.beneficiario.trim()) errori.push("Indica il beneficiario");
  if (!v.descrizione.trim()) errori.push("Indica l'oggetto del pagamento");
  if (!v.data_scadenza) errori.push("Indica la data di scadenza");
  if (totale <= 0) errori.push("L'importo deve essere maggiore di zero");
  if (netto < 0) errori.push("Il netto da pagare risulta negativo: controlla ritenuta e IVA");
  if (v.cig_esente && !v.cig_motivo_esenzione) errori.push("Indica il motivo per cui il CIG non è dovuto");
  if (v.ritenuta > 0 && !v.ritenuta_codice_tributo) errori.push("Indica il codice tributo della ritenuta (serve per l'F24)");
  if (!codiciFattura && !v.cig_esente && v.cig && !v.cig_in_fattura && ["fattura", "parcella"].includes(v.tipo))
    avvisi.push({ livello: "avviso", messaggio: "Non hai confermato che il CIG sia riportato in fattura." });
  if (!codiciFattura && v.cup && !v.cup_in_fattura && ["fattura", "parcella"].includes(v.tipo))
    avvisi.push({ livello: "avviso", messaggio: "Non hai confermato che il CUP sia riportato in fattura." });
  const bloccanti = errori.length + erroriTracc.length;

  function selezionaFornitore(id: string) {
    const f = fornitori.find((x) => x.id === id);
    setV((p) => ({
      ...p,
      fornitore_id: id,
      beneficiario: f?.denominazione ?? p.beneficiario,
      beneficiario_piva: f?.partita_iva ?? p.beneficiario_piva,
      beneficiario_cf: f?.codice_fiscale ?? p.beneficiario_cf,
      beneficiario_iban: f?.iban ?? p.beneficiario_iban,
    }));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast.error("Il file supera i 20 MB consentiti"); return; }
    setFattura(file);
    const nome = file.name.toLowerCase();
    if (!nome.endsWith(".xml") && !nome.endsWith(".p7m")) {
      toast.info("Documento allegato. Per la verifica automatica di CIG e CUP carica la fattura elettronica XML.");
      return;
    }
    setLeggendo(true);
    try {
      const f = await readFatturaXml(file);
      const fornitore = fornitori.find((x) => x.partita_iva && f.fornitore_piva && x.partita_iva.replace(/\D/g, "") === f.fornitore_piva.replace(/\D/g, ""));
      const scad = f.data_scadenza_pagamento
        || (f.data_doc ? format(addDays(parseISO(f.data_doc), 30), "yyyy-MM-dd") : "");
      setV((p) => ({
        ...p,
        tipo: p.tipo === "f24" ? p.tipo : f.ritenuta > 0 && p.tipo === "fattura" ? "parcella" : p.tipo,
        fornitore_id: fornitore?.id ?? p.fornitore_id,
        beneficiario: f.fornitore_denominazione || p.beneficiario,
        beneficiario_piva: f.fornitore_piva || p.beneficiario_piva,
        beneficiario_cf: f.fornitore_cf || p.beneficiario_cf,
        beneficiario_iban: f.iban || fornitore?.iban || p.beneficiario_iban,
        numero_documento: f.numero_doc || p.numero_documento,
        data_documento: f.data_doc || p.data_documento,
        descrizione: p.descrizione || f.causale || `Fattura n. ${f.numero_doc}`,
        imponibile: f.imponibile,
        iva: f.iva,
        split_payment: f.split_payment,
        ritenuta: f.ritenuta,
        ritenuta_codice_tributo: f.ritenuta > 0 ? p.ritenuta_codice_tributo || "1040" : p.ritenuta_codice_tributo,
        cup: p.cup || normalizzaCodice(f.cup),
        cig: p.cig || normalizzaCodice(f.cig),
        cup_in_fattura: !!f.cup,
        cig_in_fattura: !!f.cig,
        data_scadenza: p.data_scadenza || scad,
      }));
      setCodiciFattura({ cup: f.cup, cig: f.cig });
      setAvvisiPresi(false);
      toast.success("Fattura letta: dati compilati automaticamente. Verifica CIG e CUP.");
    } catch (err) {
      console.error(err);
      toast.error("Non è stato possibile leggere la fattura XML. Compila i dati manualmente.");
    } finally {
      setLeggendo(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (bloccanti) { toast.error("Correggi i campi evidenziati prima di salvare"); return; }
    if (avvisi.length && !avvisiPresi) { toast.warning("Conferma di aver preso visione degli avvisi di verifica"); return; }
    setSaving(true);
    try {
      await onSubmit({
        ...v,
        cup: normalizzaCodice(v.cup),
        cig: v.cig_esente ? "" : normalizzaCodice(v.cig),
        cup_in_fattura: codiciFattura ? !!codiciFattura.cup : v.cup_in_fattura,
        cig_in_fattura: codiciFattura ? !!codiciFattura.cig : v.cig_in_fattura,
        totale_documento: totale,
        importo_da_pagare: netto,
      }, fattura);
    } finally {
      setSaving(false);
    }
  }

  const numInput = (k: "imponibile" | "iva" | "ritenuta") => (
    <input type="number" step="0.01" min="0" className="input text-right" value={v[k] || ""}
      onChange={(e) => set(k, parseFloat(e.target.value) || 0)} />
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Fattura */}
      <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex items-center gap-4 flex-wrap bg-gray-50">
        <FileCode2 size={28} className="text-primary-600" />
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm font-medium text-gray-800">
            {fattura ? fattura.name : modalita === "modifica" ? "Sostituisci il documento di spesa (facoltativo)" : "Carica la fattura"}
          </div>
          <div className="text-xs text-gray-500">
            XML FatturaPA (anche .p7m): compila i dati e verifica CIG/CUP automaticamente. Ammessi anche PDF/immagini (max 20 MB).
          </div>
        </div>
        <label className="btn-secondary cursor-pointer">
          {leggendo ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} Scegli file
          <input type="file" className="hidden" accept=".xml,.p7m,.pdf,.jpg,.jpeg,.png,.tif,.tiff,.doc,.docx" onChange={handleFile} />
        </label>
      </div>

      {/* Beneficiario */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900 mb-2">Beneficiario e documento</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Tipologia</label>
            <select className="input" value={v.tipo} onChange={(e) => set("tipo", e.target.value as TipoScadenzaPagamento)}>
              {(Object.keys(TIPO_SCADENZA_LABELS) as TipoScadenzaPagamento[]).map((t) => <option key={t} value={t}>{TIPO_SCADENZA_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">Fornitore in anagrafica</label>
            <select className="input" value={v.fornitore_id} onChange={(e) => selezionaFornitore(e.target.value)}>
              <option value="">— Non in anagrafica / altro beneficiario —</option>
              {fornitori.map((f) => <option key={f.id} value={f.id}>{f.denominazione}{f.partita_iva ? ` (${f.partita_iva})` : ""}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="label">Beneficiario *</label>
            <input className={clsx("input", touched && !v.beneficiario.trim() && "border-red-400")} value={v.beneficiario} onChange={(e) => set("beneficiario", e.target.value)} />
          </div>
          <div>
            <label className="label">Partita IVA</label>
            <input className="input" value={v.beneficiario_piva} onChange={(e) => set("beneficiario_piva", e.target.value)} />
          </div>
          <div>
            <label className="label">Codice fiscale</label>
            <input className="input" value={v.beneficiario_cf} onChange={(e) => set("beneficiario_cf", e.target.value.toUpperCase())} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="label">IBAN beneficiario</label>
            <input className="input font-mono text-xs" value={v.beneficiario_iban} onChange={(e) => set("beneficiario_iban", e.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="IT00X0000000000000000000000" />
          </div>
          <div>
            <label className="label">N. documento</label>
            <input className="input" value={v.numero_documento} onChange={(e) => set("numero_documento", e.target.value)} />
          </div>
          <div>
            <label className="label">Data documento</label>
            <input type="date" className="input" value={v.data_documento} onChange={(e) => set("data_documento", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Oggetto del pagamento *</label>
          <input className={clsx("input", touched && !v.descrizione.trim() && "border-red-400")} value={v.descrizione} onChange={(e) => set("descrizione", e.target.value)} placeholder="Es. Servizio di assistenza tecnica — SAL 2" />
        </div>
      </fieldset>

      {/* Importi */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900 mb-2">Importi</legend>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div><label className="label">Imponibile €</label>{numInput("imponibile")}</div>
          <div><label className="label">IVA €</label>{numInput("iva")}</div>
          <div><label className="label">Ritenuta d'acconto €</label>{numInput("ritenuta")}</div>
          <div>
            <label className="label">Codice tributo ritenuta</label>
            <select className="input" value={v.ritenuta_codice_tributo} onChange={(e) => set("ritenuta_codice_tributo", e.target.value)} disabled={v.ritenuta <= 0}>
              <option value="">—</option>
              {CODICI_TRIBUTO_RITENUTA.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={v.split_payment} onChange={(e) => set("split_payment", e.target.checked)} />
          Scissione dei pagamenti (split payment): l'IVA viene versata dal GAL all'Erario con F24
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-primary-50 border border-primary-100 rounded-lg p-3 text-sm">
          <div><div className="text-xs text-gray-500">Totale documento</div><div className="font-semibold">{formatCurrency(totale)}</div></div>
          <div><div className="text-xs text-gray-500">IVA split</div><div>{v.split_payment ? `− ${formatCurrency(v.iva)}` : "—"}</div></div>
          <div><div className="text-xs text-gray-500">Ritenuta</div><div>{v.ritenuta > 0 ? `− ${formatCurrency(v.ritenuta)}` : "—"}</div></div>
          <div><div className="text-xs text-gray-500">Netto da pagare</div><div className="font-bold text-primary-800 text-base">{formatCurrency(netto)}</div></div>
        </div>
        {(v.ritenuta > 0 || (v.split_payment && v.iva > 0)) && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            Al momento del pagamento verrà creata automaticamente la scadenza F24 entro il 16 del mese successivo
            {v.ritenuta > 0 ? ` per la ritenuta (${formatCurrency(v.ritenuta)})` : ""}
            {v.split_payment && v.iva > 0 ? `${v.ritenuta > 0 ? " e" : ""} per l'IVA split (${formatCurrency(v.iva)})` : ""}.
          </p>
        )}
      </fieldset>

      {/* Tracciabilità */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900 mb-2">Tracciabilità: CUP e CIG</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">CUP * <span className="text-xs font-normal text-gray-400">(sempre obbligatorio)</span></label>
            <input className="input font-mono uppercase" maxLength={15} value={v.cup} onChange={(e) => set("cup", e.target.value.toUpperCase())} placeholder="Es. J12F23000120009" />
            {!codiciFattura && ["fattura", "parcella"].includes(v.tipo) && (
              <label className="flex items-center gap-2 text-xs text-gray-600 mt-1.5">
                <input type="checkbox" checked={v.cup_in_fattura} onChange={(e) => set("cup_in_fattura", e.target.checked)} /> Ho verificato che il CUP è riportato in fattura
              </label>
            )}
          </div>
          <div>
            <label className="label">CIG {!v.cig_esente && "*"}</label>
            <input className="input font-mono uppercase" maxLength={10} value={v.cig_esente ? "" : v.cig} disabled={v.cig_esente}
              onChange={(e) => set("cig", e.target.value.toUpperCase())} placeholder={v.cig_esente ? "Non dovuto" : "Es. B1234ABCD5"} />
            <label className="flex items-center gap-2 text-xs text-gray-600 mt-1.5">
              <input type="checkbox" checked={v.cig_esente} onChange={(e) => set("cig_esente", e.target.checked)} /> CIG non dovuto per questo pagamento
            </label>
            {!codiciFattura && !v.cig_esente && ["fattura", "parcella"].includes(v.tipo) && (
              <label className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                <input type="checkbox" checked={v.cig_in_fattura} onChange={(e) => set("cig_in_fattura", e.target.checked)} /> Ho verificato che il CIG è riportato in fattura
              </label>
            )}
          </div>
        </div>
        {v.cig_esente && (
          <div>
            <label className="label">Motivo esclusione CIG *</label>
            <select className={clsx("input", touched && !v.cig_motivo_esenzione && "border-red-400")} value={v.cig_motivo_esenzione} onChange={(e) => set("cig_motivo_esenzione", e.target.value)}>
              <option value="">Seleziona…</option>
              {MOTIVI_ESENZIONE_CIG.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        )}

        {/* Esito verifica */}
        {(touched || codiciFattura || v.cup || v.cig) && (
          <div className="space-y-1.5">
            {verifiche.map((x, i) => (
              <div key={i} className={clsx("flex items-start gap-2 text-xs rounded px-2 py-1.5",
                x.livello === "ok" && "bg-green-50 text-green-800",
                x.livello === "avviso" && "bg-amber-50 text-amber-800",
                x.livello === "errore" && "bg-red-50 text-red-700")}>
                {x.livello === "ok" ? <CheckCircle2 size={14} /> : x.livello === "avviso" ? <AlertTriangle size={14} /> : <XCircle size={14} />}
                {x.messaggio}
              </div>
            ))}
            {avvisi.filter((a) => !verifiche.includes(a)).map((x, i) => (
              <div key={`a${i}`} className="flex items-start gap-2 text-xs rounded px-2 py-1.5 bg-amber-50 text-amber-800">
                <AlertTriangle size={14} />{x.messaggio}
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="label">Note sulla verifica</label>
          <input className="input" value={v.verifica_note} onChange={(e) => set("verifica_note", e.target.value)} placeholder="Es. CIG comunicato via PEC dal fornitore il …" />
        </div>
      </fieldset>

      {/* Scadenza */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900 mb-2">Scadenza e imputazione</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Scadenza pagamento *</label>
            <input type="date" className={clsx("input", touched && !v.data_scadenza && "border-red-400")} value={v.data_scadenza} onChange={(e) => set("data_scadenza", e.target.value)} />
          </div>
          <div>
            <label className="label">Intervento</label>
            <input className="input" list="lst-interventi" value={v.intervento} onChange={(e) => set("intervento", e.target.value)} />
            <datalist id="lst-interventi">{interventi.map((i) => <option key={i} value={i} />)}</datalist>
          </div>
          <div>
            <label className="label">Capitolo di spesa</label>
            <input className="input" list="lst-capitoli" value={v.capitolo} onChange={(e) => set("capitolo", e.target.value)} />
            <datalist id="lst-capitoli">{capitoli.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <textarea className="input" rows={2} value={v.note} onChange={(e) => set("note", e.target.value)} />
        </div>
      </fieldset>

      {touched && errori.length > 0 && (
        <ul className="text-xs text-red-700 bg-red-50 rounded p-2 list-disc pl-6">
          {errori.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {avvisi.length > 0 && (
        <label className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
          <input type="checkbox" className="mt-0.5" checked={avvisiPresi} onChange={(e) => setAvvisiPresi(e.target.checked)} />
          Ho preso visione degli avvisi di verifica e intendo procedere comunque.
        </label>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annulla</button>
        <button type="submit" className="btn-primary" disabled={saving || leggendo}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          {modalita === "crea" ? "Inserisci scadenza" : "Salva modifiche"}
        </button>
      </div>
    </form>
  );
}
