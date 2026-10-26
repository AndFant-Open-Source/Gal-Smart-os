// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Edit, Trash2, Plus, ExternalLink, FileText } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import type { Bando, DomandaSostegno } from "../../types";

const STATO_DOM_COLORS: Record<string, string> = {
  presentata:  "bg-blue-100 text-blue-700",
  istruttoria: "bg-yellow-100 text-yellow-700",
  ammessa:     "bg-green-100 text-green-700",
  finanziata:  "bg-emerald-100 text-emerald-700",
  non_ammessa: "bg-red-100 text-red-700",
  rinunciata:  "bg-gray-100 text-gray-500",
  liquidata:   "bg-purple-100 text-purple-700",
};

const BANDO_STATO_COLORS: Record<string, string> = {
  bozza: "bg-gray-100 text-gray-600", aperto: "bg-green-100 text-green-700",
  chiuso: "bg-yellow-100 text-yellow-700", archiviato: "bg-red-100 text-red-600",
};

const FORM_DOM_INIT = { denominazione: "", cuaa: "", codice_agea_ds: "", comune: "", provincia: "", spesa_pubblica_ammissibile: 0, stato: "presentata" };

export default function BandoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  const [bando, setBando] = useState<Bando | null>(null);
  const [domande, setDomande] = useState<DomandaSostegno[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Bando>>({});
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showNuovaDomanda, setShowNuovaDomanda] = useState(false);
  const [formDomanda, setFormDomanda] = useState(FORM_DOM_INIT);
  const [savingDomanda, setSavingDomanda] = useState(false);

  async function loadBando() {
    if (!id) return;
    const { data } = await supabase.from("gal_bandi").select("*").eq("id", id).single();
    if (data) { setBando(data as Bando); setForm(data as Bando); }
    setLoading(false);
  }

  async function loadDomande() {
    if (!id) return;
    const { data } = await supabase.from("gal_domande_sostegno").select("*").eq("bando_id", id)
      .order("posizione_graduatoria", { ascending: true, nullsFirst: false });
    setDomande((data ?? []) as DomandaSostegno[]);
  }

  useEffect(() => { loadBando(); loadDomande(); }, [id]);

  async function handleSave() {
    if (!id || !user || !currentGal) return;
    setSaving(true);
    const { error } = await supabase.from("gal_bandi").update({
      numero: form.numero, tipologia_operazione: form.tipologia_operazione,
      titolo: form.titolo, descrizione: form.descrizione,
      data_apertura: form.data_apertura || null, data_chiusura: form.data_chiusura || null,
      dotazione_finanziaria: form.dotazione_finanziaria, stato: form.stato,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "bando", entitaId: id });
    toast.success("Bando aggiornato");
    setEditing(false); setSaving(false); loadBando();
  }

  async function handleDelete() {
    if (!id || !user || !currentGal) return;
    const { error } = await supabase.from("gal_bandi").delete().eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "bando", entitaId: id });
    toast.success("Bando eliminato");
    navigate("/bandi");
  }

  async function handleCreateDomanda(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !user || !currentGal) return;
    setSavingDomanda(true);
    const { error } = await supabase.from("gal_domande_sostegno").insert({
      gal_id: currentGal.id, bando_id: id,
      denominazione: formDomanda.denominazione, cuaa: formDomanda.cuaa || null,
      codice_agea_ds: formDomanda.codice_agea_ds || null, comune: formDomanda.comune || null,
      provincia: formDomanda.provincia || null, stato: formDomanda.stato,
      spesa_pubblica_ammissibile: formDomanda.spesa_pubblica_ammissibile,
    });
    if (error) { toast.error(messaggioErrore(error)); setSavingDomanda(false); return; }
    toast.success("Domanda creata");
    setShowNuovaDomanda(false); setSavingDomanda(false);
    setFormDomanda(FORM_DOM_INIT);
    loadDomande();
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Caricamento...</div>;
  if (!bando) return <div className="p-8 text-center text-gray-400">Bando non trovato</div>;

  const totaleAmmesso = domande.reduce((s, d) => s + (d.spesa_pubblica_ammissibile ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button className="btn-ghost" onClick={() => navigate("/bandi")}><ArrowLeft size={16} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Bando {bando.numero}</h1>
          <p className="text-sm text-gray-500">{bando.tipologia_operazione}</p>
        </div>
        <div className="flex gap-2">
          {write && !editing && <button className="btn-secondary" onClick={() => setEditing(true)}><Edit size={16} /> Modifica</button>}
          {admin && !editing && <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}><Trash2 size={16} /></button>}
          {editing && (
            <>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? "..." : "Salva"}</button>
              <button className="btn-secondary" onClick={() => setEditing(false)}>Annulla</button>
            </>
          )}
        </div>
      </div>

      <div className="card p-6">
        {editing ? (
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Numero</label><input className="input" value={form.numero ?? ""} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
            <div><label className="label">Tipologia</label><input className="input" value={form.tipologia_operazione ?? ""} onChange={(e) => setForm({ ...form, tipologia_operazione: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Titolo</label><input className="input" value={form.titolo ?? ""} onChange={(e) => setForm({ ...form, titolo: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Descrizione</label><textarea className="input" rows={3} value={form.descrizione ?? ""} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} /></div>
            <div><label className="label">Data apertura</label><input className="input" type="date" value={form.data_apertura ?? ""} onChange={(e) => setForm({ ...form, data_apertura: e.target.value })} /></div>
            <div><label className="label">Data chiusura</label><input className="input" type="date" value={form.data_chiusura ?? ""} onChange={(e) => setForm({ ...form, data_chiusura: e.target.value })} /></div>
            <div><label className="label">Dotazione (euro)</label><input className="input" type="number" value={form.dotazione_finanziaria ?? 0} onChange={(e) => setForm({ ...form, dotazione_finanziaria: parseFloat(e.target.value) || 0 })} /></div>
            <div>
              <label className="label">Stato</label>
              <select className="input" value={form.stato ?? "aperto"} onChange={(e) => setForm({ ...form, stato: e.target.value as Bando["stato"] })}>
                <option value="bozza">Bozza</option><option value="aperto">Aperto</option>
                <option value="chiuso">Chiuso</option><option value="archiviato">Archiviato</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-8 gap-y-4">
            <div><p className="text-xs text-gray-400 uppercase tracking-wide">Titolo</p><p className="font-medium">{bando.titolo}</p></div>
            <div><p className="text-xs text-gray-400 uppercase tracking-wide">Stato</p><span className={`badge ${BANDO_STATO_COLORS[bando.stato] ?? "bg-gray-100"}`}>{bando.stato}</span></div>
            <div><p className="text-xs text-gray-400 uppercase tracking-wide">Dotazione finanziaria</p><p className="font-semibold text-lg text-primary-700">{formatCurrency(bando.dotazione_finanziaria)}</p></div>
            <div><p className="text-xs text-gray-400 uppercase tracking-wide">Periodo</p><p>{formatDate(bando.data_apertura)} {" → "} {formatDate(bando.data_chiusura)}</p></div>
            {bando.descrizione && <div className="col-span-2"><p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Descrizione</p><p className="text-sm text-gray-600">{bando.descrizione}</p></div>}
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary-600" />
            <h2 className="font-semibold text-gray-800">Domande Associate</h2>
            <span className="badge bg-primary-100 text-primary-700 ml-1">{domande.length}</span>
            {domande.length > 0 && <span className="text-xs text-gray-500 ml-2">Totale: <strong>{formatCurrency(totaleAmmesso)}</strong></span>}
          </div>
          {write && <button className="btn-primary" onClick={() => setShowNuovaDomanda(true)}><Plus size={15} /> Nuova domanda</button>}
        </div>
        {domande.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            <FileText size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nessuna domanda associata a questo bando.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-header text-left">Beneficiario</th>
                  <th className="table-header text-left">CUAA</th>
                  <th className="table-header text-left">Codice AGEA</th>
                  <th className="table-header text-left">Comune</th>
                  <th className="table-header text-right">SP Ammissibile</th>
                  <th className="table-header text-center">Stato</th>
                  <th className="table-header"></th>
                </tr>
              </thead>
              <tbody>
                {domande.map((d) => (
                  <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="table-cell font-medium">{d.denominazione}</td>
                    <td className="table-cell font-mono text-xs">{d.cuaa ?? "-"}</td>
                    <td className="table-cell text-xs text-gray-500">{d.codice_agea_ds ?? "-"}</td>
                    <td className="table-cell text-sm">{d.comune ?? "-"}</td>
                    <td className="table-cell text-right font-semibold">{formatCurrency(d.spesa_pubblica_ammissibile)}</td>
                    <td className="table-cell text-center">
                      <span className={`badge ${STATO_DOM_COLORS[d.stato] ?? "bg-gray-100"}`}>{d.stato.replace(/_/g, " ")}</span>
                    </td>
                    <td className="table-cell">
                      <Link to={`/domande/${d.id}`} className="btn-ghost p-1 text-gray-400 hover:text-primary-600"><ExternalLink size={14} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={showNuovaDomanda} onClose={() => setShowNuovaDomanda(false)} title="Nuova Domanda di Sostegno" size="lg">
        <form onSubmit={handleCreateDomanda} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Denominazione beneficiario *</label>
              <input className="input" required value={formDomanda.denominazione} onChange={(e) => setFormDomanda({ ...formDomanda, denominazione: e.target.value })} />
            </div>
            <div><label className="label">CUAA</label><input className="input" value={formDomanda.cuaa} onChange={(e) => setFormDomanda({ ...formDomanda, cuaa: e.target.value })} /></div>
            <div><label className="label">Codice AGEA DS</label><input className="input" value={formDomanda.codice_agea_ds} onChange={(e) => setFormDomanda({ ...formDomanda, codice_agea_ds: e.target.value })} /></div>
            <div><label className="label">Comune intervento</label><input className="input" value={formDomanda.comune} onChange={(e) => setFormDomanda({ ...formDomanda, comune: e.target.value })} /></div>
            <div><label className="label">Provincia (sigla)</label><input className="input" value={formDomanda.provincia} maxLength={2} onChange={(e) => setFormDomanda({ ...formDomanda, provincia: e.target.value.toUpperCase() })} /></div>
            <div>
              <label className="label">Spesa pubblica ammissibile (euro)</label>
              <input className="input" type="number" step="0.01" value={formDomanda.spesa_pubblica_ammissibile} onChange={(e) => setFormDomanda({ ...formDomanda, spesa_pubblica_ammissibile: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="label">Stato</label>
              <select className="input" value={formDomanda.stato} onChange={(e) => setFormDomanda({ ...formDomanda, stato: e.target.value })}>
                <option value="presentata">Presentata</option>
                <option value="istruttoria">Istruttoria</option>
                <option value="ammessa">Ammessa</option>
                <option value="finanziata">Finanziata</option>
                <option value="non_ammessa">Non ammessa</option>
                <option value="rinunciata">Rinunciata</option>
                <option value="liquidata">Liquidata</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={savingDomanda}>{savingDomanda ? "..." : "Crea domanda"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowNuovaDomanda(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Elimina bando"
        message="Eliminare questo bando? Questa azione elimina anche tutte le domande associate ed e irreversibile."
        confirmLabel="Elimina"
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
