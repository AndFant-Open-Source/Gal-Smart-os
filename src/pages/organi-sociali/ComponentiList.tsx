// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { UserPlus, Filter } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import type { Componente, Organo } from "../../types";

type ComponenteRow = Componente & { gal_organi?: { nome: string } | null };

const DEFAULT_ORGANI = [
  { id: "__assemblea", nome: "Assemblea Soci" },
  { id: "__cda", nome: "Consiglio di Amministrazione" },
  { id: "__revisori", nome: "Revisori" },
];

const FORM_INIT: Partial<Componente> = {
  organo_id: "", nome: "", cognome: "", ruolo: "", email: "",
  data_nomina: "", data_fine_mandato: "", attivo: true,
};

export default function ComponentiList() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  const [componenti, setComponenti] = useState<ComponenteRow[]>([]);
  const [organi, setOrgani] = useState<Organo[]>([]);
  const [loading, setLoading] = useState(true);
  const [organoFilter, setOrganoFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editComp, setEditComp] = useState<ComponenteRow | null>(null);
  const [form, setForm] = useState<Partial<Componente>>(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ComponenteRow | null>(null);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    let q = supabase.from("gal_componenti").select("*, gal_organi(nome)").eq("gal_id", currentGal.id).order("nome");
    if (organoFilter) q = q.eq("organo_id", organoFilter);
    const { data } = await q;
    setComponenti((data ?? []) as ComponenteRow[]);
    const { data: orgData } = await supabase.from("gal_organi").select("*").eq("gal_id", currentGal.id).order("nome");
    setOrgani((orgData ?? []) as Organo[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id, organoFilter]);

  function openCreate() { setEditComp(null); setForm(FORM_INIT); setShowModal(true); }
  function openEdit(c: ComponenteRow) { setEditComp(c); setForm({ ...c }); setShowModal(true); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const payload = {
      gal_id: currentGal.id, organo_id: form.organo_id && !form.organo_id.startsWith("__") ? form.organo_id : null,
      nome: form.nome!, cognome: form.cognome || null, ruolo: form.ruolo || null,
      email: form.email || null, data_nomina: form.data_nomina || null,
      data_fine_mandato: form.data_fine_mandato || null, attivo: form.attivo ?? true,
    };
    let error;
    if (editComp) {
      ({ error } = await supabase.from("gal_componenti").update(payload).eq("id", editComp.id));
    } else {
      ({ error } = await supabase.from("gal_componenti").insert(payload));
    }
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: editComp ? "UPDATE" : "CREATE", entita: "componente", descrizione: `${form.nome} ${form.cognome ?? ""}` });
    toast.success(editComp ? "Componente aggiornato" : "Componente aggiunto");
    setShowModal(false); setSaving(false); load();
  }

  async function handleDelete(comp: ComponenteRow) {
    if (!currentGal || !user) return;
    const { error } = await supabase.from("gal_componenti").delete().eq("id", comp.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Componente eliminato");
    setDeleteConfirm(null); load();
  }

  const columns: Column<ComponenteRow>[] = [
    { key: "nome", label: "Nome", render: (r) => `${r.nome} ${r.cognome ?? ""}`.trim() },
    { key: "organo_id", label: "Organo", render: (r) => r.gal_organi?.nome ?? (organi.length === 0 ? DEFAULT_ORGANI.find(o => o.id === r.organo_id)?.nome : null) ?? "-" },
    { key: "ruolo", label: "Ruolo", render: (r) => r.ruolo ?? "-" },
    { key: "email", label: "Email", render: (r) => r.email ?? "-" },
    { key: "data_nomina", label: "Nomina", render: (r) => formatDate(r.data_nomina) },
    { key: "attivo", label: "Stato", render: (r) => r.attivo ? <span className="badge bg-green-100 text-green-700">Attivo</span> : <span className="badge bg-gray-100 text-gray-500">Cessato</span> },
    ...(write ? [{ key: "id" as keyof ComponenteRow, label: "", render: (r: ComponenteRow) => (
      <div className="flex gap-1">
        <button className="btn-ghost p-1 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Modifica</button>
        {admin && <button className="btn-ghost p-1 text-xs text-red-500" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(r); }}>Elimina</button>}
      </div>
    ) }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Componenti</h1>
          <p className="text-sm text-gray-500">{componenti.length} componenti</p>
        </div>
        {write && <button className="btn-primary" onClick={openCreate}><UserPlus size={16} /> Aggiungi componente</button>}
      </div>

      <div className="card p-3 flex items-center gap-3">
        <Filter size={14} className="text-gray-400" />
        <select className="input w-48 text-sm" value={organoFilter} onChange={(e) => setOrganoFilter(e.target.value)}>
          <option value="">Tutti gli organi</option>
          {(organi.length > 0 ? organi : DEFAULT_ORGANI).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      </div>

      <div className="card">
        <Table data={componenti} columns={columns} keyField="id" isLoading={loading} emptyMessage="Nessun componente trovato" />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editComp ? "Modifica Componente" : "Nuovo Componente"}>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Nome *</label><input className="input" required value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><label className="label">Cognome</label><input className="input" value={form.cognome ?? ""} onChange={(e) => setForm({ ...form, cognome: e.target.value })} /></div>
            <div>
              <label className="label">Organo</label>
              <select className="input" value={form.organo_id ?? ""} onChange={(e) => setForm({ ...form, organo_id: e.target.value })}>
                <option value="">-- Seleziona organo --</option>
                {(organi.length > 0 ? organi : DEFAULT_ORGANI).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </div>
            <div><label className="label">Ruolo</label><input className="input" value={form.ruolo ?? ""} onChange={(e) => setForm({ ...form, ruolo: e.target.value })} /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="label">Data nomina</label><input className="input" type="date" value={form.data_nomina ?? ""} onChange={(e) => setForm({ ...form, data_nomina: e.target.value })} /></div>
            <div><label className="label">Fine mandato</label><input className="input" type="date" value={form.data_fine_mandato ?? ""} onChange={(e) => setForm({ ...form, data_fine_mandato: e.target.value })} /></div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="attivo_comp" checked={form.attivo ?? true} onChange={(e) => setForm({ ...form, attivo: e.target.checked })} />
              <label htmlFor="attivo_comp" className="text-sm text-gray-700">Componente attivo</label>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : editComp ? "Aggiorna" : "Aggiungi"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteConfirm} title="Elimina componente" message={`Eliminare "${deleteConfirm?.nome} ${deleteConfirm?.cognome ?? ""}"?`} confirmLabel="Elimina" danger onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  );
}
