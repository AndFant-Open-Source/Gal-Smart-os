// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import type { Seduta } from "../../types";

const STATO_COLORS: Record<string, string> = {
  convocata: "bg-blue-100 text-blue-700",
  tenuta:    "bg-green-100 text-green-700",
  deserta:   "bg-red-100 text-red-600",
};

const DEFAULT_ORGANI = [
  { id: "__assemblea_soci", nome: "Assemblea Soci" },
  { id: "__consiglio_amministrazione", nome: "Consiglio di Amministrazione" },
  { id: "__revisori", nome: "Revisori" },
];

const FORM_INIT = { organo_id: "", numero: "", data_seduta: "", luogo: "", tipo: "ordinaria" as "ordinaria" | "straordinaria", stato: "convocata", note: "", ordine_del_giorno: "" };

export default function SedutaList() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [sedute, setSedute] = useState<Seduta[]>([]);
  const [organi, setOrgani] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const [filtroOrgano, setFiltroOrgano] = useState("");

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    const { data } = await supabase.from("gal_sedute").select("*, gal_organi(nome)").eq("gal_id", currentGal.id).order("data_seduta", { ascending: false });
    setSedute((data ?? []) as Seduta[]);
    const { data: organiData } = await supabase.from("gal_organi").select("id, nome").eq("gal_id", currentGal.id).order("nome");
    setOrgani(organiData && organiData.length > 0 ? organiData : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  // Use DB organi if available, otherwise hardcoded defaults
  const organiOptions = organi.length > 0 ? organi : DEFAULT_ORGANI;

  // Filtered sedute by organo
  const filteredSedute = filtroOrgano
    ? sedute.filter((s) => s.organo_id === filtroOrgano)
    : sedute;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);

    const payload: Record<string, unknown> = {
      gal_id: currentGal.id,
      organo_id: form.organo_id && !form.organo_id.startsWith("__") ? form.organo_id : null,
      numero: form.numero ? parseInt(form.numero) : null,
      data_seduta: form.data_seduta,
      luogo: form.luogo || null,
      tipo: form.tipo,
      stato: form.stato,
      note: form.note || null,
      ordine_del_giorno: form.ordine_del_giorno || null,
    };

    // Schema-cache fallback: try with ordine_del_giorno first
    let result = await supabase.from("gal_sedute").insert(payload);
    if (result.error && result.error.message.includes("schema cache")) {
      // Retry without the new column
      const { ordine_del_giorno: _, ...fallbackPayload } = payload;
      result = await supabase.from("gal_sedute").insert(fallbackPayload);
    }

    if (result.error) { toast.error(messaggioErrore(result.error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "seduta", descrizione: `Seduta del ${form.data_seduta}` });
    toast.success("Seduta creata");
    setShowModal(false); setSaving(false); setForm(FORM_INIT); load();
  }

  const columns: Column<Seduta>[] = [
    { key: "numero", label: "N.", width: "w-12", render: (r) => r.numero ? `#${r.numero}` : "-" },
    { key: "data_seduta", label: "Data", render: (r) => formatDate(r.data_seduta) },
    { key: "organo_id", label: "Organo", render: (r) => (r as Seduta & { gal_organi?: { nome: string } }).gal_organi?.nome ?? "-" },
    { key: "luogo", label: "Luogo", render: (r) => r.luogo ?? "-" },
    { key: "tipo", label: "Tipo", render: (r) => <span className="capitalize">{r.tipo ?? "-"}</span> },
    { key: "stato", label: "Stato", render: (r) => <span className={`badge ${STATO_COLORS[r.stato] ?? "bg-gray-100"}`}>{r.stato}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Sedute</h1>
          <p className="text-sm text-gray-500">{filteredSedute.length} sedute</p>
        </div>
        {write && <button className="btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Nuova seduta</button>}
      </div>

      {/* Filtro per organo */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-600">Filtra per organo:</label>
        <select className="input w-64" value={filtroOrgano} onChange={(e) => setFiltroOrgano(e.target.value)}>
          <option value="">Tutti gli organi</option>
          {organiOptions.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      </div>

      <div className="card">
        <Table data={filteredSedute} columns={columns} keyField="id" isLoading={loading} onRowClick={(r) => navigate(`/sedute/${r.id}`)} emptyMessage="Nessuna seduta trovata" />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuova Seduta">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Organo</label>
              <select className="input" value={form.organo_id} onChange={(e) => setForm({ ...form, organo_id: e.target.value })}>
                <option value="">-- Seleziona organo --</option>
                {organiOptions.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </div>
            <div><label className="label">Numero</label><input className="input" type="number" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} /></div>
            <div><label className="label">Data seduta *</label><input className="input" type="date" required value={form.data_seduta} onChange={(e) => setForm({ ...form, data_seduta: e.target.value })} /></div>
            <div><label className="label">Luogo</label><input className="input" value={form.luogo} onChange={(e) => setForm({ ...form, luogo: e.target.value })} /></div>
            <div>
              <label className="label">Tipo</label>
              <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as "ordinaria" | "straordinaria" })}>
                <option value="ordinaria">Ordinaria</option>
                <option value="straordinaria">Straordinaria</option>
              </select>
            </div>
            <div>
              <label className="label">Stato</label>
              <select className="input" value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}>
                <option value="convocata">Convocata</option>
                <option value="tenuta">Tenuta</option>
                <option value="deserta">Deserta</option>
              </select>
            </div>
          </div>
          <div><label className="label">Ordine del Giorno</label><textarea className="input" rows={4} placeholder="Inserisci i punti all'ordine del giorno..." value={form.ordine_del_giorno} onChange={(e) => setForm({ ...form, ordine_del_giorno: e.target.value })} /></div>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Crea seduta"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
