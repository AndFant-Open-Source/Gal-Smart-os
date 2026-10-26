// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  FUNZIONI, FUNZIONE_LABELS, PRIORITA_LABELS, RICORRENZA_LABELS, CATEGORIE_PRATICA,
  MODELLI_CHECKLIST, STATO_PRATICA_LABELS,
} from "../../constants";
import type { Funzione, PrioritaPratica, Ricorrenza, StatoPratica } from "../../types";
import { oggiISO } from "../../lib/scadenze";

export interface PraticaFormValues {
  titolo: string;
  descrizione: string;
  categoria: string;
  responsabile: Funzione;
  priorita: PrioritaPratica;
  stato: StatoPratica;
  data_apertura: string;
  data_scadenza: string;
  data_promemoria: string;
  ricorrenza: Ricorrenza;
  riferimento: string;
  note: string;
  checklist: string[]; // solo in creazione
}

export function praticaFormVuota(responsabile: Funzione = "segreteria"): PraticaFormValues {
  return {
    titolo: "", descrizione: "", categoria: "altro", responsabile, priorita: "media",
    stato: "aperta", data_apertura: oggiISO(), data_scadenza: "", data_promemoria: "",
    ricorrenza: "nessuna", riferimento: "", note: "", checklist: [],
  };
}

interface Props {
  initial: PraticaFormValues;
  modalita: "crea" | "modifica";
  onSubmit: (v: PraticaFormValues) => Promise<void>;
  onCancel: () => void;
}

export default function PraticaForm({ initial, modalita, onSubmit, onCancel }: Props) {
  const [v, setV] = useState<PraticaFormValues>(initial);
  const [nuovaVoce, setNuovaVoce] = useState("");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const errori: Partial<Record<keyof PraticaFormValues, string>> = {};
  if (!v.titolo.trim()) errori.titolo = "Indica cosa c'è da fare";
  if (!v.data_scadenza) errori.data_scadenza = "La data di scadenza è obbligatoria";
  else if (v.data_apertura && v.data_scadenza < v.data_apertura) errori.data_scadenza = "La scadenza non può precedere l'apertura";
  if (v.data_promemoria && v.data_scadenza && v.data_promemoria > v.data_scadenza) errori.data_promemoria = "Il promemoria deve precedere la scadenza";
  const valido = Object.keys(errori).length === 0;

  function set<K extends keyof PraticaFormValues>(k: K, val: PraticaFormValues[K]) {
    setV((p) => ({ ...p, [k]: val }));
  }

  function applicaModello(nome: string) {
    const m = MODELLI_CHECKLIST.find((x) => x.nome === nome);
    if (!m) return;
    setV((p) => ({
      ...p,
      categoria: p.categoria === "altro" ? m.categoria : p.categoria,
      titolo: p.titolo || m.nome,
      checklist: [...p.checklist, ...m.voci.filter((x) => !p.checklist.includes(x))],
    }));
  }

  function aggiungiVoce() {
    const t = nuovaVoce.trim();
    if (!t) return;
    set("checklist", [...v.checklist, t]);
    setNuovaVoce("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valido) return;
    setSaving(true);
    try {
      await onSubmit(v);
    } finally {
      setSaving(false);
    }
  }

  const err = (k: keyof PraticaFormValues) =>
    touched && errori[k] ? <p className="text-xs text-red-600 mt-1">{errori[k]}</p> : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Cosa c'è da fare *</label>
        <input className="input" value={v.titolo} onChange={(e) => set("titolo", e.target.value)}
          onBlur={() => setTouched(true)} placeholder="Es. Convocazione CdA per approvazione graduatoria" />
        {err("titolo")}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="label">Responsabile *</label>
          <select className="input" value={v.responsabile} onChange={(e) => set("responsabile", e.target.value as Funzione)}>
            {FUNZIONI.map((f) => <option key={f} value={f}>{FUNZIONE_LABELS[f]}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Categoria</label>
          <select className="input" value={v.categoria} onChange={(e) => set("categoria", e.target.value)}>
            {CATEGORIE_PRATICA.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Priorità</label>
          <select className="input" value={v.priorita} onChange={(e) => set("priorita", e.target.value as PrioritaPratica)}>
            {(Object.keys(PRIORITA_LABELS) as PrioritaPratica[]).map((p) => <option key={p} value={p}>{PRIORITA_LABELS[p]}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="label">Data apertura</label>
          <input type="date" className="input" value={v.data_apertura} onChange={(e) => set("data_apertura", e.target.value)} />
        </div>
        <div>
          <label className="label">Scadenza *</label>
          <input type="date" className="input" value={v.data_scadenza} onChange={(e) => set("data_scadenza", e.target.value)} />
          {err("data_scadenza")}
        </div>
        <div>
          <label className="label">Promemoria dal</label>
          <input type="date" className="input" value={v.data_promemoria} onChange={(e) => set("data_promemoria", e.target.value)} />
          {err("data_promemoria")}
        </div>
        <div>
          <label className="label">Ricorrenza</label>
          <select className="input" value={v.ricorrenza} onChange={(e) => set("ricorrenza", e.target.value as Ricorrenza)}>
            {(Object.keys(RICORRENZA_LABELS) as Ricorrenza[]).map((r) => <option key={r} value={r}>{RICORRENZA_LABELS[r]}</option>)}
          </select>
        </div>
      </div>

      {modalita === "modifica" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="label">Stato</label>
            <select className="input" value={v.stato} onChange={(e) => set("stato", e.target.value as StatoPratica)}>
              {(Object.keys(STATO_PRATICA_LABELS) as StatoPratica[]).map((s) => <option key={s} value={s}>{STATO_PRATICA_LABELS[s]}</option>)}
            </select>
          </div>
        </div>
      )}

      <div>
        <label className="label">Descrizione</label>
        <textarea className="input" rows={3} value={v.descrizione} onChange={(e) => set("descrizione", e.target.value)}
          placeholder="Dettagli, riferimenti normativi, documenti necessari…" />
      </div>

      <div>
        <label className="label">Riferimento (protocollo, bando, delibera…)</label>
        <input className="input" value={v.riferimento} onChange={(e) => set("riferimento", e.target.value)} placeholder="Es. Prot. 123/2026 — Bando SRD07" />
      </div>

      {modalita === "crea" && (
        <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Check list ({v.checklist.length} voci)</span>
            <select className="input w-auto py-1 text-xs" value="" onChange={(e) => applicaModello(e.target.value)}>
              <option value="">+ Applica un modello…</option>
              {MODELLI_CHECKLIST.map((m) => <option key={m.nome} value={m.nome}>{m.nome}</option>)}
            </select>
          </div>
          {v.checklist.map((voce, i) => (
            <div key={i} className="flex items-center gap-2 text-sm bg-white border rounded px-2 py-1.5">
              <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
              <span className="flex-1">{voce}</span>
              <button type="button" className="text-xs text-red-500 hover:underline"
                onClick={() => set("checklist", v.checklist.filter((_, j) => j !== i))}>Rimuovi</button>
            </div>
          ))}
          <div className="flex gap-2">
            <input className="input" value={nuovaVoce} onChange={(e) => setNuovaVoce(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aggiungiVoce(); } }}
              placeholder="Aggiungi un passaggio e premi Invio" />
            <button type="button" className="btn-secondary" onClick={aggiungiVoce}>Aggiungi</button>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t">
        <button type="button" className="btn-secondary" onClick={onCancel}>Annulla</button>
        <button type="submit" className="btn-primary" disabled={saving || (touched && !valido)}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          {modalita === "crea" ? "Apri pratica" : "Salva modifiche"}
        </button>
      </div>
    </form>
  );
}
