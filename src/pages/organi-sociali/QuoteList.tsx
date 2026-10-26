// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { Plus, Upload, Download, FileSpreadsheet } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import * as XLSX from "xlsx";
import type { QuotaSociale } from "../../types";

type QuotaRow = QuotaSociale & { gal_soci: { denominazione: string; codice_socio: string | null } | null };

const FORM_INIT = { socio_id: "", anno: new Date().getFullYear(), quota: 0, data_versamento: "", note: "" };

const TEMPLATE_COLUMNS = [
  "Denominazione Socio", "Anno", "Importo Quota", "Data Versamento (gg/mm/aaaa)", "Note",
];

const TEMPLATE_EXAMPLE = [
  "Comune di Roma", "2025", "500.00", "15/01/2025", "Quota annuale",
];

export default function QuoteList() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  const [quote, setQuote] = useState<QuotaRow[]>([]);
  const [soci, setSoci] = useState<{ id: string; denominazione: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<QuotaRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!currentGal) return;
    setLoading(true);

    // Load soci first (needed for import matching)
    const { data: sociData } = await supabase.from("gal_soci").select("id, denominazione").eq("gal_id", currentGal.id).eq("attivo", true).order("denominazione");
    setSoci(sociData ?? []);

    // Load quote with try-catch in case table doesn't exist yet
    try {
      const { data, error } = await supabase.from("gal_quote_sociali").select("*, gal_soci(denominazione, codice_socio)").eq("gal_id", currentGal.id).order("anno", { ascending: false });
      if (error) {
        toast.error("Tabella gal_quote_sociali non trovata nel database. Esegui lo script SQL per crearla.");
        setQuote([]);
      } else {
        setQuote((data ?? []) as QuotaRow[]);
      }
    } catch {
      toast.error("Tabella gal_quote_sociali non trovata nel database. Esegui lo script SQL per crearla.");
      setQuote([]);
    }

    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const { error } = await supabase.from("gal_quote_sociali").insert({
      gal_id: currentGal.id, socio_id: form.socio_id, anno: form.anno, quota: form.quota,
      data_versamento: form.data_versamento || null, note: form.note || null,
    });
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "quota_sociale", descrizione: `Quota ${form.anno} - ${formatCurrency(form.quota)}` });
    toast.success("Quota registrata");
    setShowModal(false); setSaving(false); setForm(FORM_INIT); load();
  }

  async function handleDelete(q: QuotaRow) {
    if (!currentGal || !user) return;
    const { error } = await supabase.from("gal_quote_sociali").delete().eq("id", q.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "quota_sociale", descrizione: `Quota ${q.anno} - ${q.gal_soci?.denominazione ?? ""}` });
    toast.success("Quota eliminata");
    setDeleteConfirm(null); load();
  }

  function handleExport() {
    const rows = quote.map((q) => ({
      "Socio": q.gal_soci?.denominazione ?? "-",
      "Anno": q.anno,
      "Importo Quota": q.quota,
      "Data Versamento": formatDate(q.data_versamento),
      "Note": q.note ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quote Sociali");
    XLSX.writeFile(wb, `quote_sociali_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleDownloadTemplate() {
    const wsData = [TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = TEMPLATE_COLUMNS.map((col) => ({ wch: Math.max(col.length + 2, 18) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template Quote");
    XLSX.writeFile(wb, "template_importazione_quote.xlsx");
    toast.success("Template scaricato");
  }

  function parseDateDDMMYYYY(raw: string): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Try dd/mm/yyyy or dd-mm-yyyy
    const match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (match) {
      const day = match[1].padStart(2, "0");
      const month = match[2].padStart(2, "0");
      const year = match[3];
      return `${year}-${month}-${day}`;
    }
    // Try yyyy-mm-dd (already ISO)
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return null;
  }

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !currentGal || !user) return;

    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) { toast.error("Il file Excel non contiene fogli"); return; }

      const rows = XLSX.utils.sheet_to_json<Record<string, string | number | undefined>>(workbook.Sheets[sheetName]);
      if (rows.length === 0) { toast.error("Il file Excel è vuoto"); return; }

      let imported = 0;
      let skipped = 0;
      const payloads: { gal_id: string; socio_id: string; anno: number; quota: number; data_versamento: string | null; note: string | null }[] = [];

      for (const row of rows) {
        const denominazioneRaw = String(row["Denominazione Socio"] ?? "").trim();
        if (!denominazioneRaw) { skipped++; continue; }

        // Case-insensitive match against loaded soci list
        const socio = soci.find((s) => s.denominazione.toLowerCase() === denominazioneRaw.toLowerCase());
        if (!socio) { skipped++; continue; }

        const annoRaw = row["Anno"];
        const anno = typeof annoRaw === "number" ? annoRaw : parseInt(String(annoRaw ?? ""), 10);
        if (isNaN(anno)) { skipped++; continue; }

        const quotaRaw = row["Importo Quota"];
        const quota = typeof quotaRaw === "number" ? quotaRaw : parseFloat(String(quotaRaw ?? "0")) || 0;

        const dataRaw = String(row["Data Versamento (gg/mm/aaaa)"] ?? "").trim();
        const dataVersamento = parseDateDDMMYYYY(dataRaw);

        const note = String(row["Note"] ?? "").trim() || null;

        payloads.push({
          gal_id: currentGal.id,
          socio_id: socio.id,
          anno,
          quota,
          data_versamento: dataVersamento,
          note,
        });
      }

      if (payloads.length === 0) {
        toast.error(`Nessuna quota importabile. ${skipped} righe saltate (socio non trovato o dati mancanti).`);
        return;
      }

      const { error } = await supabase.from("gal_quote_sociali").insert(payloads);
      if (error) { toast.error(messaggioErrore(error, "Errore importazione")); return; }

      imported = payloads.length;

      await logAudit({
        galId: currentGal.id, userId: user.id, username: user.nome_completo,
        azione: "CREATE", entita: "quota_sociale",
        descrizione: `Importazione Excel: ${imported} quote importate, ${skipped} righe saltate`,
      });

      toast.success(`Importate ${imported} quote. ${skipped > 0 ? `${skipped} righe saltate.` : ""}`);
      load();
    } catch {
      toast.error("Errore nella lettura del file Excel. Verifica il formato.");
    }
  }

  const columns: Column<QuotaRow>[] = [
    { key: "anno", label: "Anno", width: "w-16" },
    { key: "socio_id", label: "Socio", render: (r) => r.gal_soci?.denominazione ?? "-" },
    { key: "quota", label: "Quota (euro)", render: (r) => formatCurrency(r.quota) },
    { key: "data_versamento", label: "Versamento", render: (r) => formatDate(r.data_versamento) },
    { key: "note", label: "Note", render: (r) => r.note ?? "-" },
    ...(admin ? [{ key: "id" as keyof QuotaRow, label: "", render: (r: QuotaRow) => (
      <button className="btn-ghost p-1 text-xs text-red-500" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(r); }}>Elimina</button>
    ) }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Quote Sociali</h1>
          <p className="text-sm text-gray-500">{quote.length} quote registrate</p>
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
              <button className="btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Registra quota</button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <Table data={quote} columns={columns} keyField="id" isLoading={loading} emptyMessage="Nessuna quota registrata" />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Registra Quota Sociale">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label">Socio *</label>
            <select className="input" required value={form.socio_id} onChange={(e) => setForm({ ...form, socio_id: e.target.value })}>
              <option value="">-- Seleziona socio --</option>
              {soci.map((s) => <option key={s.id} value={s.id}>{s.denominazione}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Anno</label><input className="input" type="number" value={form.anno} onChange={(e) => setForm({ ...form, anno: parseInt(e.target.value) || new Date().getFullYear() })} /></div>
            <div><label className="label">Importo quota (euro)</label><input className="input" type="number" step="0.01" value={form.quota} onChange={(e) => setForm({ ...form, quota: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Data versamento</label><input className="input" type="date" value={form.data_versamento} onChange={(e) => setForm({ ...form, data_versamento: e.target.value })} /></div>
            <div><label className="label">Note</label><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteConfirm} title="Elimina quota" message="Eliminare questa quota?" confirmLabel="Elimina" danger onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  );
}
