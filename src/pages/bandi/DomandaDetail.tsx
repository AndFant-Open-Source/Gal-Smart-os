// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Edit, Trash2, Plus, Save, X } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import type { DomandaSostegno, PagamentoBando } from "../../types";

const STATO_COLORS: Record<string, string> = {
  presentata:  "bg-blue-100 text-blue-700",
  istruttoria: "bg-yellow-100 text-yellow-700",
  ammessa:     "bg-green-100 text-green-700",
  finanziata:  "bg-emerald-100 text-emerald-700",
  non_ammessa: "bg-red-100 text-red-700",
  rinunciata:  "bg-gray-100 text-gray-500",
  liquidata:   "bg-purple-100 text-purple-700",
};

export default function DomandaDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  const [domanda, setDomanda] = useState<DomandaSostegno | null>(null);
  const [pagamenti, setPagamenti] = useState<PagamentoBando[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<DomandaSostegno>>({});
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPagamento, setShowPagamento] = useState(false);
  const [formPag, setFormPag] = useState({ tipo: "acconto" as "acconto" | "sal" | "saldo", importo: 0, data_pagamento: "", note: "" });
  const [savingPag, setSavingPag] = useState(false);

  async function load() {
    if (!id) return;
    const { data } = await supabase.from("gal_domande_sostegno").select("*, gal_bandi(titolo, numero)").eq("id", id).single();
    if (data) { setDomanda(data as DomandaSostegno); setForm(data as DomandaSostegno); }
    const { data: pags } = await supabase.from("gal_pagamenti_bando").select("*").eq("domanda_id", id).order("data_pagamento");
    setPagamenti((pags ?? []) as PagamentoBando[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleSave() {
    if (!id || !user || !currentGal) return;
    setSaving(true);
    const { error } = await supabase.from("gal_domande_sostegno").update({
      denominazione: form.denominazione, cuaa: form.cuaa, codice_agea_ds: form.codice_agea_ds,
      comune: form.comune, provincia: form.provincia, stato: form.stato,
      spesa_pubblica_ammissibile: form.spesa_pubblica_ammissibile,
      contributo_concesso: form.contributo_concesso,
      posizione_graduatoria: form.posizione_graduatoria,
      data_presentazione: form.data_presentazione || null,
      data_concessione: form.data_concessione || null,
      note: form.note,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "domanda", entitaId: id });
    toast.success("Domanda aggiornata");
    setEditing(false); setSaving(false); load();
  }

  async function handleDelete() {
    if (!id || !user || !currentGal) return;
    const { error } = await supabase.from("gal_domande_sostegno").delete().eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "domanda", entitaId: id });
    toast.success("Domanda eliminata");
    navigate(-1);
  }

  async function handleAddPagamento(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !currentGal) return;
    setSavingPag(true);
    const { error } = await supabase.from("gal_pagamenti_bando").insert({
      gal_id: currentGal.id, domanda_id: id,
      tipo: formPag.tipo, importo: formPag.importo,
      data_pagamento: formPag.data_pagamento || null,
      note: formPag.note || null,
    });
    if (error) { toast.error(messaggioErrore(error)); setSavingPag(false); return; }
    toast.success("Pagamento registrato");
    setShowPagamento(false); setSavingPag(false);
    setFormPag({ tipo: "acconto", importo: 0, data_pagamento: "", note: "" });
    load();
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Caricamento...</div>;
  if (!domanda) return <div className="p-8 text-center text-gray-400">Domanda non trovata</div>;

  const totalePagato = pagamenti.reduce((s, p) => s + (p.importo ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button className="btn-ghost" onClick={() => navigate(-1)}><ArrowLeft size={16} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{domanda.denominazione}</h1>
          <p className="text-sm text-gray-500">
            {domanda.cuaa && <span className="font-mono">{domanda.cuaa}</span>}
            {(domanda as DomandaSostegno & { gal_bandi?: { titolo?: string; numero?: string } }).gal_bandi?.numero && (
              <span className="ml-2 text-gray-400">Bando {(domanda as DomandaSostegno & { gal_bandi?: { titolo?: string; numero?: string } }).gal_bandi?.numero}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${STATO_COLORS[domanda.stato] ?? "bg-gray-100"}`}>{domanda.stato.replace(/_/g, " ")}</span>
          {write && !editing && <button className="btn-secondary" onClick={() => setEditing(true)}><Edit size={16} /> Modifica</button>}
          {admin && !editing && <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}><Trash2 size={16} /></button>}
          {editing && (
            <>
              <button className="btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? "..." : "Salva"}</button>
              <button className="btn-secondary" onClick={() => setEditing(false)}><X size={16} /> Annulla</button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5 text-center">
          <p className="text-xs text-gray-400 uppercase mb-1">SP Ammissibile</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(domanda.spesa_pubblica_ammissibile)}</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-xs text-gray-400 uppercase mb-1">Contributo concesso</p>
          <p className="text-2xl font-bold text-primary-700">{formatCurrency(domanda.contributo_concesso)}</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-xs text-gray-400 uppercase mb-1">Totale pagato</p>
          <p className="text-2xl font-bold text-green-700">{formatCurrency(totalePagato)}</p>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Dati Domanda</h2>
        {editing ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Denominazione *</label>
              <input className="input" required value={form.denominazione ?? ""} onChange={(e) => setForm({ ...form, denominazione: e.target.value })} />
            </div>
            <div><label className="label">CUAA</label><input className="input" value={form.cuaa ?? ""} onChange={(e) => setForm({ ...form, cuaa: e.target.value })} /></div>
            <div><label className="label">Codice AGEA DS</label><input className="input" value={form.codice_agea_ds ?? ""} onChange={(e) => setForm({ ...form, codice_agea_ds: e.target.value })} /></div>
            <div><label className="label">Comune intervento</label><input className="input" value={form.comune ?? ""} onChange={(e) => setForm({ ...form, comune: e.target.value })} /></div>
            <div><label className="label">Provincia</label><input className="input" value={form.provincia ?? ""} maxLength={2} onChange={(e) => setForm({ ...form, provincia: e.target.value.toUpperCase() })} /></div>
            <div><label className="label">SP Ammissibile (euro)</label><input className="input" type="number" step="0.01" value={form.spesa_pubblica_ammissibile ?? 0} onChange={(e) => setForm({ ...form, spesa_pubblica_ammissibile: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Contributo concesso (euro)</label><input className="input" type="number" step="0.01" value={form.contributo_concesso ?? 0} onChange={(e) => setForm({ ...form, contributo_concesso: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Pos. graduatoria</label><input className="input" type="number" value={form.posizione_graduatoria ?? ""} onChange={(e) => setForm({ ...form, posizione_graduatoria: parseInt(e.target.value) || undefined })} /></div>
            <div>
              <label className="label">Stato</label>
              <select className="input" value={form.stato ?? "presentata"} onChange={(e) => setForm({ ...form, stato: e.target.value as DomandaSostegno["stato"] })}>
                <option value="presentata">Presentata</option>
                <option value="istruttoria">Istruttoria</option>
                <option value="ammessa">Ammessa</option>
                <option value="finanziata">Finanziata</option>
                <option value="non_ammessa">Non ammessa</option>
                <option value="rinunciata">Rinunciata</option>
                <option value="liquidata">Liquidata</option>
              </select>
            </div>
            <div><label className="label">Data presentazione</label><input className="input" type="date" value={form.data_presentazione ?? ""} onChange={(e) => setForm({ ...form, data_presentazione: e.target.value })} /></div>
            <div><label className="label">Data concessione</label><input className="input" type="date" value={form.data_concessione ?? ""} onChange={(e) => setForm({ ...form, data_concessione: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Note</label><textarea className="input" rows={3} value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-8 gap-y-4 text-sm">
            <div><p className="text-xs text-gray-400 uppercase">CUAA</p><p className="font-mono">{domanda.cuaa ?? "-"}</p></div>
            <div><p className="text-xs text-gray-400 uppercase">Codice AGEA DS</p><p>{domanda.codice_agea_ds ?? "-"}</p></div>
            <div><p className="text-xs text-gray-400 uppercase">Pos. Graduatoria</p><p className="font-bold text-primary-700">{domanda.posizione_graduatoria ? `#${domanda.posizione_graduatoria}` : "-"}</p></div>
            <div><p className="text-xs text-gray-400 uppercase">Comune</p><p>{domanda.comune ?? "-"}</p></div>
            <div><p className="text-xs text-gray-400 uppercase">Provincia</p><p>{domanda.provincia ?? "-"}</p></div>
            <div><p className="text-xs text-gray-400 uppercase">Stato</p><span className={`badge ${STATO_COLORS[domanda.stato] ?? "bg-gray-100"}`}>{domanda.stato.replace(/_/g, " ")}</span></div>
            <div><p className="text-xs text-gray-400 uppercase">Data presentazione</p><p>{formatDate(domanda.data_presentazione)}</p></div>
            <div><p className="text-xs text-gray-400 uppercase">Data concessione</p><p>{formatDate(domanda.data_concessione)}</p></div>
            {domanda.note && <div className="col-span-3"><p className="text-xs text-gray-400 uppercase">Note</p><p className="text-gray-600">{domanda.note}</p></div>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Pagamenti</h2>
          {write && <button className="btn-primary" onClick={() => setShowPagamento(true)}><Plus size={15} /> Aggiungi pagamento</button>}
        </div>
        {pagamenti.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nessun pagamento registrato</div>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-gray-100">
              <th className="table-header text-left">Tipo</th>
              <th className="table-header text-left">Data</th>
              <th className="table-header text-right">Importo</th>
              <th className="table-header text-left">Note</th>
            </tr></thead>
            <tbody>
              {pagamenti.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="table-cell"><span className="badge bg-blue-100 text-blue-700 capitalize">{p.tipo}</span></td>
                  <td className="table-cell">{formatDate(p.data_pagamento)}</td>
                  <td className="table-cell text-right font-semibold">{formatCurrency(p.importo)}</td>
                  <td className="table-cell text-sm text-gray-500">{p.note ?? "-"}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-semibold">
                <td className="table-cell" colSpan={2}>Totale pagato</td>
                <td className="table-cell text-right text-green-700">{formatCurrency(totalePagato)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <Modal open={showPagamento} onClose={() => setShowPagamento(false)} title="Registra Pagamento">
        <form onSubmit={handleAddPagamento} className="space-y-4">
          <div>
            <label className="label">Tipo pagamento</label>
            <select className="input" value={formPag.tipo} onChange={(e) => setFormPag({ ...formPag, tipo: e.target.value as "acconto" | "sal" | "saldo" })}>
              <option value="acconto">Acconto</option>
              <option value="sal">SAL</option>
              <option value="saldo">Saldo</option>
            </select>
          </div>
          <div><label className="label">Importo (euro) *</label><input className="input" type="number" step="0.01" required value={formPag.importo} onChange={(e) => setFormPag({ ...formPag, importo: parseFloat(e.target.value) || 0 })} /></div>
          <div><label className="label">Data pagamento</label><input className="input" type="date" value={formPag.data_pagamento} onChange={(e) => setFormPag({ ...formPag, data_pagamento: e.target.value })} /></div>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={formPag.note} onChange={(e) => setFormPag({ ...formPag, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={savingPag}>{savingPag ? "..." : "Salva pagamento"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowPagamento(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={showDeleteConfirm} title="Elimina domanda" message="Eliminare questa domanda? L'operazione e irreversibile." confirmLabel="Elimina" danger onConfirm={handleDelete} onCancel={() => setShowDeleteConfirm(false)} />
    </div>
  );
}
