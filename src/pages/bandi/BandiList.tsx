// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import type { Bando } from "../../types";

const STATO_COLORS: Record<string, string> = {
  bozza:     "bg-gray-100 text-gray-600",
  aperto:    "bg-green-100 text-green-700",
  chiuso:    "bg-yellow-100 text-yellow-700",
  archiviato:"bg-red-100 text-red-600",
};

const FORM_INIT = {
  numero: "", tipologia_operazione: "", titolo: "",
  descrizione: "", data_apertura: "", data_chiusura: "",
  dotazione_finanziaria: 0, stato: "aperto",
};

type BandoRow = Bando & { num_domande: number };

export default function BandiList() {
  const [bandi, setBandi] = useState<BandoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("gal_bandi")
      .select("*, gal_domande_sostegno(count)")
      .eq("gal_id", currentGal.id)
      .order("created_at", { ascending: false });
    if (error) { toast.error("Errore caricamento bandi"); setLoading(false); return; }
    const mapped = (data ?? []).map((b: Record<string, unknown>) => ({
      ...b,
      num_domande: Array.isArray(b.gal_domande_sostegno)
        ? (b.gal_domande_sostegno as { count: number }[])[0]?.count ?? 0
        : 0,
    }));
    setBandi(mapped as BandoRow[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const { data, error } = await supabase.from("gal_bandi").insert({
      gal_id: currentGal.id,
      numero: form.numero,
      tipologia_operazione: form.tipologia_operazione || null,
      titolo: form.titolo,
      descrizione: form.descrizione || null,
      data_apertura: form.data_apertura || null,
      data_chiusura: form.data_chiusura || null,
      dotazione_finanziaria: form.dotazione_finanziaria,
      stato: form.stato,
    }).select().single();
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "bando", entitaId: data.id, descrizione: `Creato bando ${form.numero}` });
    toast.success("Bando creato con successo");
    setShowModal(false);
    setForm(FORM_INIT);
    load();
    setSaving(false);
  }

  const columns: Column<BandoRow>[] = [
    { key: "numero", label: "N. Bando", width: "w-24" },
    { key: "tipologia_operazione", label: "Tipologia", render: (r) => r.tipologia_operazione ?? "-" },
    { key: "titolo", label: "Titolo" },
    { key: "stato", label: "Stato", render: (r) => <span className={`badge ${STATO_COLORS[r.stato] ?? "bg-gray-100"}`}>{r.stato}</span> },
    { key: "dotazione_finanziaria", label: "Dotazione", render: (r) => formatCurrency(r.dotazione_finanziaria) },
    { key: "num_domande", label: "Domande", render: (r) => <span className="badge bg-blue-100 text-blue-700">{r.num_domande}</span> },
    { key: "data_apertura", label: "Apertura", render: (r) => formatDate(r.data_apertura) },
    { key: "data_chiusura", label: "Chiusura", render: (r) => formatDate(r.data_chiusura) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Bandi</h1>
          <p className="text-sm text-gray-500">{bandi.length} bandi nel sistema</p>
        </div>
        {write && (
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Nuovo bando
          </button>
        )}
      </div>

      <div className="card">
        <Table data={bandi} columns={columns} keyField="id" isLoading={loading} onRowClick={(r) => navigate(`/bandi/${r.id}`)} />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuovo Bando">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Numero bando *</label>
              <input className="input" required value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="es. 1/2024" />
            </div>
            <div>
              <label className="label">Tipologia operazione</label>
              <input className="input" value={form.tipologia_operazione} onChange={(e) => setForm({ ...form, tipologia_operazione: e.target.value })} placeholder="es. 19.2.1" />
            </div>
          </div>
          <div>
            <label className="label">Titolo *</label>
            <input className="input" required value={form.titolo} onChange={(e) => setForm({ ...form, titolo: e.target.value })} />
          </div>
          <div>
            <label className="label">Descrizione</label>
            <textarea className="input" rows={3} value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Data apertura</label>
              <input className="input" type="date" value={form.data_apertura} onChange={(e) => setForm({ ...form, data_apertura: e.target.value })} />
            </div>
            <div>
              <label className="label">Data chiusura</label>
              <input className="input" type="date" value={form.data_chiusura} onChange={(e) => setForm({ ...form, data_chiusura: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Dotazione finanziaria (€)</label>
              <input className="input" type="number" step="0.01" value={form.dotazione_finanziaria} onChange={(e) => setForm({ ...form, dotazione_finanziaria: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="label">Stato</label>
              <select className="input" value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}>
                <option value="bozza">Bozza</option>
                <option value="aperto">Aperto</option>
                <option value="chiuso">Chiuso</option>
                <option value="archiviato">Archiviato</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "Salvataggio..." : "Salva bando"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
