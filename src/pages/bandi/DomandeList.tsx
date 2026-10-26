// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency } from "../../lib/utils";
import { Plus, Search, Download } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import * as XLSX from "xlsx";
import type { DomandaSostegno } from "../../types";

const STATO_COLORS: Record<string, string> = {
  presentata:  "bg-blue-100 text-blue-700",
  istruttoria: "bg-yellow-100 text-yellow-700",
  ammessa:     "bg-green-100 text-green-700",
  finanziata:  "bg-emerald-100 text-emerald-700",
  non_ammessa: "bg-red-100 text-red-700",
  rinunciata:  "bg-gray-100 text-gray-500",
  liquidata:   "bg-purple-100 text-purple-700",
};

const FORM_INIT = {
  denominazione: "", cuaa: "", codice_agea_ds: "",
  comune: "", provincia: "", spesa_pubblica_ammissibile: 0, stato: "presentata",
};

export default function DomandeList() {
  const { bandoId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [domande, setDomande] = useState<DomandaSostegno[]>([]);
  const [bandi, setBandi] = useState<{ id: string; numero: string; titolo: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statoFilter, setStatoFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [formBandoId, setFormBandoId] = useState(bandoId ?? "");
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    let q = supabase.from("gal_domande_sostegno").select("*, gal_bandi(titolo, numero)").eq("gal_id", currentGal.id);
    if (bandoId) q = q.eq("bando_id", bandoId);
    if (statoFilter) q = q.eq("stato", statoFilter);
    q = q.order("denominazione");
    const { data } = await q;
    setDomande((data ?? []) as DomandaSostegno[]);

    const { data: bandiData } = await supabase.from("gal_bandi").select("id, numero, titolo").eq("gal_id", currentGal.id).order("numero");
    setBandi(bandiData ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id, bandoId, statoFilter]);

  const filtered = domande.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [d.denominazione, d.cuaa ?? "", d.codice_agea_ds ?? "", d.comune ?? ""].some((v) => v.toLowerCase().includes(q));
  });

  function handleExport() {
    const rows = filtered.map((d) => ({
      "Beneficiario": d.denominazione,
      "CUAA": d.cuaa ?? "",
      "Codice AGEA DS": d.codice_agea_ds ?? "",
      "Comune": d.comune ?? "",
      "Provincia": d.provincia ?? "",
      "SP Ammissibile": d.spesa_pubblica_ammissibile,
      "Contributo concesso": d.contributo_concesso,
      "Pos. Graduatoria": d.posizione_graduatoria ?? "",
      "Stato": d.stato,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Domande");
    XLSX.writeFile(wb, `domande_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const { error } = await supabase.from("gal_domande_sostegno").insert({
      gal_id: currentGal.id,
      bando_id: formBandoId || null,
      denominazione: form.denominazione,
      cuaa: form.cuaa || null,
      codice_agea_ds: form.codice_agea_ds || null,
      comune: form.comune || null,
      provincia: form.provincia || null,
      stato: form.stato,
      spesa_pubblica_ammissibile: form.spesa_pubblica_ammissibile,
    });
    if (error) { alert("Errore: " + error.message); setSaving(false); return; }
    setShowModal(false);
    setForm(FORM_INIT);
    setSaving(false);
    load();
  }

  const columns: Column<DomandaSostegno>[] = [
    { key: "posizione_graduatoria", label: "Pos.", width: "w-12", render: (r) => r.posizione_graduatoria ? <span className="font-mono text-xs font-bold text-primary-700">#{r.posizione_graduatoria}</span> : <span className="text-gray-300">-</span> },
    { key: "codice_agea_ds", label: "Codice AGEA", width: "w-32", render: (r) => r.codice_agea_ds ?? "-" },
    { key: "cuaa", label: "CUAA", width: "w-32", render: (r) => r.cuaa ?? "-" },
    { key: "denominazione", label: "Beneficiario" },
    { key: "comune", label: "Comune", render: (r) => r.comune ?? "-" },
    { key: "spesa_pubblica_ammissibile", label: "SP Ammissibile", render: (r) => formatCurrency(r.spesa_pubblica_ammissibile) },
    { key: "stato", label: "Stato", render: (r) => <span className={`badge ${STATO_COLORS[r.stato] ?? "bg-gray-100"}`}>{r.stato.replace(/_/g, " ")}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Domande di Sostegno</h1>
          <p className="text-sm text-gray-500">{filtered.length} di {domande.length} domande</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={handleExport}><Download size={16} /> Export Excel</button>
          {write && <button className="btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Nuova domanda</button>}
        </div>
      </div>

      <div className="card p-3 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 text-sm" placeholder="Cerca beneficiario, CUAA..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-44 text-sm" value={statoFilter} onChange={(e) => setStatoFilter(e.target.value)}>
          <option value="">Tutti gli stati</option>
          <option value="presentata">Presentata</option>
          <option value="istruttoria">Istruttoria</option>
          <option value="ammessa">Ammessa</option>
          <option value="finanziata">Finanziata</option>
          <option value="non_ammessa">Non ammessa</option>
          <option value="rinunciata">Rinunciata</option>
          <option value="liquidata">Liquidata</option>
        </select>
      </div>

      <div className="card">
        <Table data={filtered} columns={columns} keyField="id" isLoading={loading} onRowClick={(r) => navigate(`/domande/${r.id}`)} emptyMessage="Nessuna domanda trovata" />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuova Domanda di Sostegno" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="label">Bando di riferimento</label>
            <select className="input" value={formBandoId} onChange={(e) => setFormBandoId(e.target.value)}>
              <option value="">-- Nessun bando --</option>
              {bandi.map((b) => <option key={b.id} value={b.id}>{b.numero} - {b.titolo}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Denominazione beneficiario *</label>
              <input className="input" required value={form.denominazione} onChange={(e) => setForm({ ...form, denominazione: e.target.value })} />
            </div>
            <div><label className="label">CUAA</label><input className="input" value={form.cuaa} onChange={(e) => setForm({ ...form, cuaa: e.target.value })} /></div>
            <div><label className="label">Codice AGEA DS</label><input className="input" value={form.codice_agea_ds} onChange={(e) => setForm({ ...form, codice_agea_ds: e.target.value })} /></div>
            <div><label className="label">Comune intervento</label><input className="input" value={form.comune} onChange={(e) => setForm({ ...form, comune: e.target.value })} /></div>
            <div><label className="label">Provincia</label><input className="input" value={form.provincia} maxLength={2} onChange={(e) => setForm({ ...form, provincia: e.target.value.toUpperCase() })} /></div>
            <div>
              <label className="label">SP Ammissibile (euro)</label>
              <input className="input" type="number" step="0.01" value={form.spesa_pubblica_ammissibile} onChange={(e) => setForm({ ...form, spesa_pubblica_ammissibile: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="label">Stato</label>
              <select className="input" value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}>
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
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Crea domanda"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
