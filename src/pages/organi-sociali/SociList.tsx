// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { Plus, Download, Search, UserCheck, UserX, Upload, FileSpreadsheet } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import * as XLSX from "xlsx";
import type { Socio, TipoSocio } from "../../types";

const TIPO_COLORS: Record<string, string> = {
  "Ente Pubblico": "bg-blue-100 text-blue-700",
  "Privato":       "bg-gray-100 text-gray-700",
  "Associazione":  "bg-purple-100 text-purple-700",
  "Altro":         "bg-yellow-100 text-yellow-700",
};

const FORM_INIT: Partial<Socio> = {
  codice_socio: "", tipo_socio: "Privato", denominazione: "", codice_fiscale: "",
  partita_iva: "", comune: "", provincia: "", indirizzo: "", email: "", pec: "", telefono: "",
  rappresentante_legale: "", quota_partecipazione: 0, data_adesione: "", attivo: true,
};

const TEMPLATE_COLUMNS = [
  "Codice", "Tipo", "Denominazione", "Codice Fiscale", "Partita IVA",
  "Comune", "Provincia", "Indirizzo", "Email", "PEC", "Telefono",
  "Rappresentante Legale", "Quota %", "Data Adesione", "Attivo",
];

const TEMPLATE_EXAMPLE = [
  "S001", "Ente Pubblico", "Comune di Roma", "00000000000", "00000000000",
  "Roma", "RM", "Via del Corso 1", "info@comune.roma.it", "protocollo@pec.comune.roma.it",
  "06123456", "Mario Rossi", "5.50", "2024-01-15", "Si",
];

const VALID_TIPI: TipoSocio[] = ["Ente Pubblico", "Privato", "Associazione", "Altro"];

export default function SociList() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  const [soci, setSoci] = useState<Socio[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAttivo, setFilterAttivo] = useState<"" | "true" | "false">("");
  const [showModal, setShowModal] = useState(false);
  const [editSocio, setEditSocio] = useState<Socio | null>(null);
  const [form, setForm] = useState<Partial<Socio>>(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Socio | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    let q = supabase.from("gal_soci").select("*").eq("gal_id", currentGal.id).order("denominazione");
    if (filterAttivo !== "") q = q.eq("attivo", filterAttivo === "true");
    const { data } = await q;
    setSoci((data ?? []) as Socio[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id, filterAttivo]);

  const filtered = soci.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [s.denominazione, s.codice_fiscale ?? "", s.comune ?? "", s.rappresentante_legale ?? ""].some((v) => v.toLowerCase().includes(q));
  });

  function openCreate() { setEditSocio(null); setForm(FORM_INIT); setShowModal(true); }
  function openEdit(s: Socio) { setEditSocio(s); setForm({ ...s }); setShowModal(true); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const payload = {
      gal_id: currentGal.id,
      codice_socio: form.codice_socio || null,
      tipo_socio: form.tipo_socio as TipoSocio,
      denominazione: form.denominazione!,
      codice_fiscale: form.codice_fiscale || null,
      partita_iva: form.partita_iva || null,
      comune: form.comune || null,
      provincia: form.provincia || null,
      indirizzo: form.indirizzo || null,
      email: form.email || null,
      pec: form.pec || null,
      telefono: form.telefono || null,
      rappresentante_legale: form.rappresentante_legale || null,
      quota_partecipazione: form.quota_partecipazione ?? 0,
      data_adesione: form.data_adesione || null,
      data_recesso: form.data_recesso || null,
      attivo: form.attivo ?? true,
      note: form.note || null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editSocio) {
      ({ error } = await supabase.from("gal_soci").update(payload).eq("id", editSocio.id));
    } else {
      ({ error } = await supabase.from("gal_soci").insert(payload));
    }
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: editSocio ? "UPDATE" : "CREATE", entita: "socio", descrizione: form.denominazione });
    toast.success(editSocio ? "Socio aggiornato" : "Socio creato");
    setShowModal(false); setSaving(false); load();
  }

  async function handleDelete(socio: Socio) {
    if (!currentGal || !user) return;
    const { error } = await supabase.from("gal_soci").delete().eq("id", socio.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "socio", descrizione: socio.denominazione });
    toast.success("Socio eliminato");
    setDeleteConfirm(null); load();
  }

  function handleExport() {
    const rows = filtered.map((s) => ({
      "Codice": s.codice_socio ?? "", "Tipo": s.tipo_socio, "Denominazione": s.denominazione,
      "CF": s.codice_fiscale ?? "", "P.IVA": s.partita_iva ?? "", "Comune": s.comune ?? "",
      "Prov.": s.provincia ?? "", "Email": s.email ?? "", "Telefono": s.telefono ?? "",
      "Rappresentante": s.rappresentante_legale ?? "", "Quota %": s.quota_partecipazione,
      "Data adesione": formatDate(s.data_adesione), "Attivo": s.attivo ? "Si" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Libro Soci");
    XLSX.writeFile(wb, `libro_soci_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleDownloadTemplate() {
    const wsData = [TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // Set column widths for readability
    ws["!cols"] = TEMPLATE_COLUMNS.map((col) => ({ wch: Math.max(col.length + 2, 18) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Soci");
    XLSX.writeFile(wb, "template_importazione_soci.xlsx");
    toast.success("Template scaricato");
  }

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !currentGal || !user) return;

    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) { toast.error("Il file Excel non contiene fogli"); return; }

      const rows = XLSX.utils.sheet_to_json<Record<string, string | number | undefined>>(workbook.Sheets[sheetName]);
      if (rows.length === 0) { toast.error("Il file Excel è vuoto"); return; }

      const payloads = rows.map((row) => {
        const tipoRaw = String(row["Tipo"] ?? "Privato").trim();
        const tipo: TipoSocio = VALID_TIPI.includes(tipoRaw as TipoSocio) ? (tipoRaw as TipoSocio) : "Privato";
        const attivoRaw = String(row["Attivo"] ?? "Si").trim().toLowerCase();
        const attivo = attivoRaw !== "no";
        const quotaRaw = row["Quota %"];
        const quota = typeof quotaRaw === "number" ? quotaRaw : parseFloat(String(quotaRaw ?? "0")) || 0;

        return {
          gal_id: currentGal.id,
          codice_socio: String(row["Codice"] ?? "").trim() || null,
          tipo_socio: tipo,
          denominazione: String(row["Denominazione"] ?? "").trim(),
          codice_fiscale: String(row["Codice Fiscale"] ?? "").trim() || null,
          partita_iva: String(row["Partita IVA"] ?? "").trim() || null,
          comune: String(row["Comune"] ?? "").trim() || null,
          provincia: String(row["Provincia"] ?? "").trim().toUpperCase() || null,
          indirizzo: String(row["Indirizzo"] ?? "").trim() || null,
          email: String(row["Email"] ?? "").trim() || null,
          pec: String(row["PEC"] ?? "").trim() || null,
          telefono: String(row["Telefono"] ?? "").trim() || null,
          rappresentante_legale: String(row["Rappresentante Legale"] ?? "").trim() || null,
          quota_partecipazione: quota,
          data_adesione: String(row["Data Adesione"] ?? "").trim() || null,
          attivo,
        };
      });

      // Filter out rows without denominazione
      const validPayloads = payloads.filter((p) => p.denominazione.length > 0);
      if (validPayloads.length === 0) {
        toast.error("Nessuna riga valida trovata. Verifica che la colonna 'Denominazione' sia compilata.");
        return;
      }

      const { error } = await supabase.from("gal_soci").insert(validPayloads);
      if (error) { toast.error(messaggioErrore(error, "Errore importazione")); return; }

      await logAudit({
        galId: currentGal.id, userId: user.id, username: user.nome_completo,
        azione: "CREATE", entita: "socio",
        descrizione: `Importazione Excel: ${validPayloads.length} soci importati`,
      });

      toast.success(`Importati ${validPayloads.length} soci con successo`);
      load();
    } catch (err) {
      toast.error("Errore nella lettura del file Excel. Verifica il formato.");
    }
  }

  const columns: Column<Socio>[] = [
    { key: "codice_socio", label: "Codice", width: "w-20", render: (r) => r.codice_socio ?? "-" },
    { key: "tipo_socio", label: "Tipo", render: (r) => <span className={`badge ${TIPO_COLORS[r.tipo_socio] ?? "bg-gray-100"}`}>{r.tipo_socio}</span> },
    { key: "denominazione", label: "Denominazione" },
    { key: "rappresentante_legale", label: "Rappresentante", render: (r) => r.rappresentante_legale ?? "-" },
    { key: "comune", label: "Comune", render: (r) => r.comune ?? "-" },
    { key: "quota_partecipazione", label: "Quota %", render: (r) => `${r.quota_partecipazione}%` },
    { key: "data_adesione", label: "Adesione", render: (r) => formatDate(r.data_adesione) },
    { key: "attivo", label: "Stato", render: (r) => r.attivo ? <span className="badge bg-green-100 text-green-700 flex items-center gap-1"><UserCheck size={11} /> Attivo</span> : <span className="badge bg-red-100 text-red-600 flex items-center gap-1"><UserX size={11} /> Uscito</span> },
    ...(write ? [{ key: "id" as keyof Socio, label: "", render: (r: Socio) => (
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
          <h1 className="text-xl font-bold text-gray-900">Libro Soci</h1>
          <p className="text-sm text-gray-500">{filtered.length} soci</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={handleDownloadTemplate}><FileSpreadsheet size={16} /> Scarica Template</button>
          <button className="btn-secondary" onClick={handleExport}><Download size={16} /> Export Excel</button>
          {write && (
            <>
              <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Importa Excel</button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImportExcel}
              />
              <button className="btn-primary" onClick={openCreate}><Plus size={16} /> Nuovo socio</button>
            </>
          )}
        </div>
      </div>

      <div className="card p-3 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 text-sm" placeholder="Cerca denominazione, CF..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-40 text-sm" value={filterAttivo} onChange={(e) => setFilterAttivo(e.target.value as "" | "true" | "false")}>
          <option value="">Tutti</option>
          <option value="true">Solo attivi</option>
          <option value="false">Usciti</option>
        </select>
      </div>

      <div className="card">
        <Table data={filtered} columns={columns} keyField="id" isLoading={loading} emptyMessage="Nessun socio trovato" />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editSocio ? "Modifica Socio" : "Nuovo Socio"} size="xl">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Codice socio</label><input className="input" value={form.codice_socio ?? ""} onChange={(e) => setForm({ ...form, codice_socio: e.target.value })} /></div>
            <div>
              <label className="label">Tipo socio</label>
              <select className="input" value={form.tipo_socio ?? "Privato"} onChange={(e) => setForm({ ...form, tipo_socio: e.target.value as TipoSocio })}>
                <option>Ente Pubblico</option><option>Privato</option><option>Associazione</option><option>Altro</option>
              </select>
            </div>
            <div><label className="label">Quota %</label><input className="input" type="number" step="0.01" value={form.quota_partecipazione ?? 0} onChange={(e) => setForm({ ...form, quota_partecipazione: parseFloat(e.target.value) || 0 })} /></div>
            <div className="col-span-3"><label className="label">Denominazione *</label><input className="input" required value={form.denominazione ?? ""} onChange={(e) => setForm({ ...form, denominazione: e.target.value })} /></div>
            <div><label className="label">Codice fiscale</label><input className="input" value={form.codice_fiscale ?? ""} onChange={(e) => setForm({ ...form, codice_fiscale: e.target.value })} /></div>
            <div><label className="label">Partita IVA</label><input className="input" value={form.partita_iva ?? ""} onChange={(e) => setForm({ ...form, partita_iva: e.target.value })} /></div>
            <div><label className="label">Rappresentante legale</label><input className="input" value={form.rappresentante_legale ?? ""} onChange={(e) => setForm({ ...form, rappresentante_legale: e.target.value })} /></div>
            <div><label className="label">Comune</label><input className="input" value={form.comune ?? ""} onChange={(e) => setForm({ ...form, comune: e.target.value })} /></div>
            <div><label className="label">Provincia</label><input className="input" value={form.provincia ?? ""} maxLength={2} onChange={(e) => setForm({ ...form, provincia: e.target.value.toUpperCase() })} /></div>
            <div><label className="label">Indirizzo</label><input className="input" value={form.indirizzo ?? ""} onChange={(e) => setForm({ ...form, indirizzo: e.target.value })} /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="label">PEC</label><input className="input" type="email" value={form.pec ?? ""} onChange={(e) => setForm({ ...form, pec: e.target.value })} /></div>
            <div><label className="label">Telefono</label><input className="input" value={form.telefono ?? ""} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
            <div><label className="label">Data adesione</label><input className="input" type="date" value={form.data_adesione ?? ""} onChange={(e) => setForm({ ...form, data_adesione: e.target.value })} /></div>
            <div><label className="label">Data recesso</label><input className="input" type="date" value={form.data_recesso ?? ""} onChange={(e) => setForm({ ...form, data_recesso: e.target.value })} /></div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="attivo" checked={form.attivo ?? true} onChange={(e) => setForm({ ...form, attivo: e.target.checked })} />
              <label htmlFor="attivo" className="text-sm text-gray-700">Socio attivo</label>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : editSocio ? "Aggiorna" : "Crea socio"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteConfirm} title="Elimina socio" message={`Eliminare il socio "${deleteConfirm?.denominazione}"?`} confirmLabel="Elimina" danger onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  );
}
