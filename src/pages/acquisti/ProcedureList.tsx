// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { Plus, Download, Search, AlertTriangle } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import * as XLSX from "xlsx";
import type { Procedura, StatoProcedura } from "../../types";

const STATI_PROCEDURA: StatoProcedura[] = [
  "fabbisogno", "determina", "scelta_procedura", "preventivi_inviti",
  "affidamento", "contratto", "esecuzione", "pagamenti", "trasparenza", "chiusa",
];

const STATO_COLORS: Record<string, string> = {
  fabbisogno: "bg-gray-100 text-gray-600",
  determina: "bg-yellow-100 text-yellow-700",
  scelta_procedura: "bg-blue-100 text-blue-700",
  preventivi_inviti: "bg-purple-100 text-purple-700",
  affidamento: "bg-orange-100 text-orange-700",
  contratto: "bg-teal-100 text-teal-700",
  esecuzione: "bg-cyan-100 text-cyan-700",
  pagamenti: "bg-green-100 text-green-700",
  trasparenza: "bg-indigo-100 text-indigo-700",
  chiusa: "bg-gray-100 text-gray-500",
};

const FORM_INIT = {
  oggetto: "",
  tipo_procedura: "affidamento_diretto",
  importo_stimato: 0,
  cig: "",
  cup: "",
  rup_nome: "",
  rup_email: "",
  note: "",
};

export default function ProcedureList() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [procedure, setProcedure] = useState<Procedura[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statoFilter, setStatoFilter] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    let q = supabase.from("gal_procedure").select("*").eq("gal_id", currentGal.id).order("created_at", { ascending: false });
    if (statoFilter) q = q.eq("stato", statoFilter);
    const { data } = await q;
    setProcedure((data ?? []) as Procedura[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id, statoFilter]);

  const filtered = search
    ? procedure.filter((p) =>
        [p.oggetto, p.cig ?? "", p.codice ?? "", p.fornitore_aggiudicatario ?? ""]
          .some((v) => v.toLowerCase().includes(search.toLowerCase()))
      )
    : procedure;

  const totaleStimato = filtered.reduce((s, p) => s + p.importo_stimato, 0);
  const totaleAggiudicato = filtered.reduce((s, p) => s + (p.importo_aggiudicato ?? 0), 0);
  const senzaCig = filtered.filter((p) => !p.cig && p.stato !== "fabbisogno").length;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const { error } = await supabase.from("gal_procedure").insert({
      gal_id: currentGal.id,
      oggetto: form.oggetto,
      tipo_procedura: form.tipo_procedura,
      importo_stimato: form.importo_stimato,
      cig: form.cig || null,
      cup: form.cup || null,
      rup_nome: form.rup_nome || null,
      rup_email: form.rup_email || null,
      stato: "fabbisogno",
      pubblicato_anac: false,
      importo_aggiudicato: null,
      note: form.note || null,
    });
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "procedura", descrizione: form.oggetto });
    toast.success("Procedura creata");
    setShowModal(false); setSaving(false); setForm(FORM_INIT); load();
  }

  function handleExport() {
    const rows = filtered.map((p) => ({
      "Codice": p.codice ?? "",
      "Oggetto": p.oggetto,
      "Tipo": p.tipo_procedura ?? "",
      "Importo Stimato": p.importo_stimato,
      "Importo Aggiudicato": p.importo_aggiudicato ?? "",
      "CIG": p.cig ?? "",
      "CUP": p.cup ?? "",
      "RUP": p.rup_nome ?? "",
      "Fornitore": p.fornitore_aggiudicatario ?? "",
      "Stato": p.stato,
      "ANAC": p.pubblicato_anac ? "Sì" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Procedure");
    XLSX.writeFile(wb, `procedure_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const columns: Column<Procedura>[] = [
    { key: "codice", label: "Codice", render: (r) => r.codice ? <span className="font-mono text-xs">{r.codice}</span> : "-" },
    { key: "oggetto", label: "Oggetto", render: (r) => <span className="font-medium">{r.oggetto}</span> },
    { key: "tipo_procedura", label: "Tipo", render: (r) => <span className="text-xs">{r.tipo_procedura?.replace(/_/g, " ") ?? "-"}</span> },
    { key: "importo_stimato", label: "Stimato", render: (r) => formatCurrency(r.importo_stimato) },
    { key: "importo_aggiudicato", label: "Aggiudicato", render: (r) => r.importo_aggiudicato != null ? formatCurrency(r.importo_aggiudicato) : "-" },
    { key: "cig", label: "CIG", render: (r) => r.cig
      ? <span className="font-mono text-xs">{r.cig}</span>
      : r.stato !== "fabbisogno" ? <span className="text-red-500 flex items-center gap-1"><AlertTriangle size={12} /> mancante</span> : "-"
    },
    { key: "stato", label: "Stato", render: (r) => <span className={`badge ${STATO_COLORS[r.stato] ?? "bg-gray-100"}`}>{r.stato.replace(/_/g, " ")}</span> },
    { key: "pubblicato_anac", label: "ANAC", render: (r) => <span className={r.pubblicato_anac ? "text-green-600 text-xs" : "text-gray-400 text-xs"}>{r.pubblicato_anac ? "✓" : "–"}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Procedure di Acquisto</h1>
          <p className="text-sm text-gray-500">{filtered.length} procedure</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={handleExport}><Download size={16} /> Export Excel</button>
          {write && <button className="btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Nuova</button>}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Totale stimato</p>
          <p className="text-xl font-bold">{formatCurrency(totaleStimato)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Totale aggiudicato</p>
          <p className="text-xl font-bold text-green-700">{formatCurrency(totaleAggiudicato)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Senza CIG</p>
          <p className={`text-xl font-bold ${senzaCig > 0 ? "text-red-600" : "text-gray-400"}`}>{senzaCig}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Cerca oggetto, CIG, fornitore..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-52" value={statoFilter} onChange={(e) => setStatoFilter(e.target.value)}>
          <option value="">Tutti gli stati</option>
          {STATI_PROCEDURA.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      <div className="card">
        <Table
          data={filtered}
          columns={columns}
          keyField="id"
          isLoading={loading}
          onRowClick={(r) => navigate(`/procedure/${r.id}`)}
          emptyMessage="Nessuna procedura trovata"
        />
      </div>

      {/* Modal creazione */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuova Procedura" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Oggetto *</label>
            <input className="input" required value={form.oggetto} onChange={(e) => setForm({ ...form, oggetto: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Tipo procedura</label>
              <select className="input" value={form.tipo_procedura} onChange={(e) => setForm({ ...form, tipo_procedura: e.target.value })}>
                <option value="affidamento_diretto">Affidamento diretto</option>
                <option value="procedura_negoziata">Procedura negoziata</option>
                <option value="rdo_mepa">RDO MePa</option>
                <option value="oda_mepa">OdA MePa</option>
                <option value="aperta">Procedura aperta</option>
                <option value="accordo_quadro">Accordo quadro</option>
                <option value="convenzione">Convenzione</option>
                <option value="cottimo_fiduciario">Cottimo fiduciario</option>
                <option value="altro">Altro</option>
              </select></div>
            <div><label className="label">Importo stimato (€) *</label>
              <input className="input" type="number" step="0.01" required value={form.importo_stimato}
                onChange={(e) => setForm({ ...form, importo_stimato: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">CIG</label><input className="input font-mono" value={form.cig} onChange={(e) => setForm({ ...form, cig: e.target.value })} /></div>
            <div><label className="label">CUP</label><input className="input font-mono" value={form.cup} onChange={(e) => setForm({ ...form, cup: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">RUP - Nome</label><input className="input" value={form.rup_nome} onChange={(e) => setForm({ ...form, rup_nome: e.target.value })} /></div>
            <div><label className="label">RUP - Email</label><input className="input" type="email" value={form.rup_email} onChange={(e) => setForm({ ...form, rup_email: e.target.value })} /></div>
          </div>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Crea procedura"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
