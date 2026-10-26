// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";
import { Plus, Pencil, Loader2, Landmark } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCurrency, formatDate } from "../../lib/utils";
import { oggiISO } from "../../lib/scadenze";
import { TIPO_CONTO_LABELS } from "../../constants";
import Modal from "../ui/Modal";
import type { ContoCorrente, TipoConto } from "../../types";

interface Props {
  galId: string;
  conti: ContoCorrente[];
  saldi: Map<string, number>;
  write: boolean;
  onChange: () => void;
}

const VUOTO = {
  nome: "", banca: "", iban: "", tipo: "conto_corrente" as TipoConto,
  saldo_iniziale: 0, data_saldo_iniziale: oggiISO(), attivo: true, note: "",
};

export default function ContiTab({ galId, conti, saldi, write, onChange }: Props) {
  const [edit, setEdit] = useState<ContoCorrente | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(VUOTO);
  const [saving, setSaving] = useState(false);

  function apri(c: ContoCorrente | null) {
    setEdit(c);
    setForm(c ? {
      nome: c.nome, banca: c.banca ?? "", iban: c.iban ?? "", tipo: c.tipo,
      saldo_iniziale: Number(c.saldo_iniziale), data_saldo_iniziale: c.data_saldo_iniziale,
      attivo: c.attivo, note: c.note ?? "",
    } : { ...VUOTO, data_saldo_iniziale: oggiISO() });
    setOpen(true);
  }

  async function salva(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) { toast.error("Indica il nome del conto"); return; }
    if (form.iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(form.iban)) { toast.error("L'IBAN non sembra valido"); return; }
    setSaving(true);
    const payload = {
      nome: form.nome.trim(), banca: form.banca || null, iban: form.iban || null, tipo: form.tipo,
      saldo_iniziale: form.saldo_iniziale, data_saldo_iniziale: form.data_saldo_iniziale,
      attivo: form.attivo, note: form.note || null,
    };
    const { error } = edit
      ? await supabase.from("gal_conti").update(payload).eq("id", edit.id)
      : await supabase.from("gal_conti").insert({ ...payload, gal_id: galId });
    setSaving(false);
    if (error) { console.error(error); toast.error("Salvataggio del conto non riuscito"); return; }
    toast.success(edit ? "Conto aggiornato" : "Conto aggiunto");
    setOpen(false);
    onChange();
  }

  const totale = conti.filter((c) => c.attivo).reduce((t, c) => t + (saldi.get(c.id) ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Il saldo attuale è calcolato dal saldo iniziale più incassi e pagamenti registrati dopo quella data.</p>
        {write && <button className="btn-primary" onClick={() => apri(null)}><Plus size={16} /> Nuovo conto</button>}
      </div>
      {conti.length === 0 ? (
        <div className="card p-12 text-center text-gray-400 space-y-2">
          <Landmark size={32} className="mx-auto" />
          <p>Nessun conto configurato. Aggiungi i conti correnti del GAL per monitorare la liquidità.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="table-header text-left">Conto</th>
                <th className="table-header text-left">IBAN</th>
                <th className="table-header text-right">Saldo iniziale</th>
                <th className="table-header text-right">Saldo attuale</th>
                <th className="table-header"></th>
              </tr>
            </thead>
            <tbody>
              {conti.map((c) => {
                const saldo = saldi.get(c.id) ?? 0;
                return (
                  <tr key={c.id} className={clsx("border-b border-gray-100", !c.attivo && "opacity-50")}>
                    <td className="table-cell">
                      <div className="font-medium">{c.nome}{!c.attivo && <span className="badge bg-gray-100 text-gray-500 ml-2">Chiuso</span>}</div>
                      <div className="text-xs text-gray-400">{[c.banca, TIPO_CONTO_LABELS[c.tipo]].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="table-cell font-mono text-xs">{c.iban ?? "—"}</td>
                    <td className="table-cell text-right">
                      {formatCurrency(c.saldo_iniziale)}
                      <div className="text-xs text-gray-400">al {formatDate(c.data_saldo_iniziale)}</div>
                    </td>
                    <td className={clsx("table-cell text-right font-semibold", saldo < 0 ? "text-red-600" : "text-gray-900")}>{formatCurrency(saldo)}</td>
                    <td className="table-cell text-right">
                      {write && <button className="btn-ghost p-1.5" onClick={() => apri(c)} title="Modifica"><Pencil size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="table-cell" colSpan={3}>Totale conti attivi</td>
                <td className={clsx("table-cell text-right", totale < 0 && "text-red-600")}>{formatCurrency(totale)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? "Modifica conto" : "Nuovo conto"}>
        <form onSubmit={salva} className="space-y-3">
          <div><label className="label">Nome conto *</label><input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Es. C/C dedicato PSR" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Banca</label><input className="input" value={form.banca} onChange={(e) => setForm({ ...form, banca: e.target.value })} /></div>
            <div>
              <label className="label">Tipologia</label>
              <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoConto })}>
                {(Object.keys(TIPO_CONTO_LABELS) as TipoConto[]).map((t) => <option key={t} value={t}>{TIPO_CONTO_LABELS[t]}</option>)}
              </select>
            </div>
          </div>
          <div><label className="label">IBAN</label><input className="input font-mono" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value.toUpperCase().replace(/\s/g, "") })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Saldo iniziale €</label><input type="number" step="0.01" className="input text-right" value={form.saldo_iniziale} onChange={(e) => setForm({ ...form, saldo_iniziale: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Alla data</label><input type="date" className="input" value={form.data_saldo_iniziale} onChange={(e) => setForm({ ...form, data_saldo_iniziale: e.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.attivo} onChange={(e) => setForm({ ...form, attivo: e.target.checked })} /> Conto attivo</label>
          <div><label className="label">Note</label><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Annulla</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving && <Loader2 size={16} className="animate-spin" />} Salva</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
