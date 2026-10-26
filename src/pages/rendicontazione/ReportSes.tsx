// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, logAudit, messaggioErrore } from "../../lib/utils";
import { generateMultiSectionPdf, pdfEur, pdfDate } from "../../lib/pdf";
import { toast } from "sonner";
import { Plus, Download, FileText, Trash2, FileDown } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import * as XLSX from "xlsx";
import type { Periodo, RigaImputazione } from "../../types";

interface RiepilogoCategoria {
  categoria_spesa: string;
  imponibile: number;
  iva: number;
  totale: number;
  n_righe: number;
}

const FORM_INIT = {
  codice: "",
  descrizione: "",
  data_inizio: "",
  data_fine: "",
  anno_riferimento: new Date().getFullYear(),
  misura: "",
  sotto_misura: "",
  perc_feasr: 43,
  note: "",
  stato: "aperto",
};

export default function ReportSes() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [periodi, setPeriodi] = useState<Periodo[]>([]);
  const [selectedPeriodo, setSelectedPeriodo] = useState<string>("");
  const [riepilogo, setRiepilogo] = useState<RiepilogoCategoria[]>([]);
  const [righe, setRighe] = useState<RigaImputazione[]>([]);
  const [activeTab, setActiveTab] = useState<"riepilogo" | "elenco">("riepilogo");
  const [loading, setLoading] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editPeriodo, setEditPeriodo] = useState<Periodo | null>(null);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Periodo | null>(null);

  async function loadPeriodi() {
    if (!currentGal) return;
    const { data } = await supabase
      .from("gal_periodi_ses")
      .select("*")
      .eq("gal_id", currentGal.id)
      .order("codice");
    setPeriodi((data ?? []) as Periodo[]);
  }

  useEffect(() => {
    loadPeriodi();
  }, [currentGal?.id]);

  useEffect(() => {
    if (selectedPeriodo) loadReport();
  }, [selectedPeriodo]);

  async function loadReport() {
    if (!currentGal || !selectedPeriodo) return;
    setLoading(true);

    const { data: righeData } = await supabase
      .from("gal_righe_imputazione")
      .select(`*, gal_giustificativi!inner(numero_doc, data_doc, fornitore_denominazione, cig, gal_id)`)
      .eq("periodo_id", selectedPeriodo)
      .eq("gal_giustificativi.gal_id", currentGal.id);

    const allRighe = (righeData ?? []) as RigaImputazione[];
    setRighe(allRighe);

    // Group by categoria_spesa
    const map: Record<string, RiepilogoCategoria> = {};
    for (const r of allRighe) {
      const cat = r.categoria_spesa;
      if (!map[cat]) map[cat] = { categoria_spesa: cat, imponibile: 0, iva: 0, totale: 0, n_righe: 0 };
      map[cat].imponibile += r.imponibile_imputato;
      map[cat].iva += r.iva_imputato;
      map[cat].totale += r.totale_imputato;
      map[cat].n_righe += 1;
    }
    setRiepilogo(Object.values(map).sort((a, b) => a.categoria_spesa.localeCompare(b.categoria_spesa)));
    setLoading(false);
  }

  const periodo = periodi.find((p) => p.id === selectedPeriodo);
  const totRiepilogo = riepilogo.reduce((s, r) => s + r.totale, 0);
  const quotaFeasr = periodo ? totRiepilogo * (periodo.perc_feasr / 100) : 0;
  const quotaNazionale = totRiepilogo - quotaFeasr;

  function openCreate() {
    setEditPeriodo(null);
    setForm(FORM_INIT);
    setShowModal(true);
  }

  function openEdit(p: Periodo) {
    setEditPeriodo(p);
    setForm({
      codice: p.codice,
      descrizione: p.descrizione,
      data_inizio: p.data_inizio ?? "",
      data_fine: p.data_fine ?? "",
      anno_riferimento: p.anno_riferimento ?? new Date().getFullYear(),
      misura: p.misura ?? "",
      sotto_misura: p.sotto_misura ?? "",
      perc_feasr: p.perc_feasr,
      note: p.note ?? "",
      stato: p.stato,
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const payload = {
      gal_id: currentGal.id,
      codice: form.codice,
      descrizione: form.descrizione,
      data_inizio: form.data_inizio || null,
      data_fine: form.data_fine || null,
      anno_riferimento: form.anno_riferimento || null,
      misura: form.misura || null,
      sotto_misura: form.sotto_misura || null,
      perc_feasr: form.perc_feasr,
      note: form.note || null,
      stato: form.stato,
    };
    let error;
    if (editPeriodo) {
      ({ error } = await supabase.from("gal_periodi_ses").update(payload).eq("id", editPeriodo.id));
    } else {
      ({ error } = await supabase.from("gal_periodi_ses").insert(payload));
    }
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: editPeriodo ? "UPDATE" : "CREATE", entita: "periodo_ses", descrizione: form.codice });
    toast.success(editPeriodo ? "Periodo aggiornato" : "Periodo creato");
    setShowModal(false); setSaving(false); setEditPeriodo(null); setForm(FORM_INIT);
    loadPeriodi();
  }

  async function handleDelete(p: Periodo) {
    if (!currentGal || !user) return;
    const { error } = await supabase.from("gal_periodi_ses").delete().eq("id", p.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Periodo eliminato");
    setDeleteConfirm(null);
    if (selectedPeriodo === p.id) setSelectedPeriodo("");
    loadPeriodi();
  }

  function handleExportRiepilogo() {
    const rows = riepilogo.map((r) => ({
      "Categoria Spesa": r.categoria_spesa,
      "N. Righe": r.n_righe,
      "Imponibile": r.imponibile,
      "IVA": r.iva,
      "Totale": r.totale,
    }));
    rows.push({ "Categoria Spesa": "TOTALE", "N. Righe": riepilogo.reduce((s, r) => s + r.n_righe, 0), "Imponibile": riepilogo.reduce((s, r) => s + r.imponibile, 0), "IVA": riepilogo.reduce((s, r) => s + r.iva, 0), "Totale": totRiepilogo });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Riepilogo SES");
    XLSX.writeFile(wb, `ses_${periodo?.codice ?? "report"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleExportElenco() {
    const rows = righe.map((r: any) => ({
      "N. Documento": r.gal_giustificativi?.numero_doc ?? "",
      "Data": r.gal_giustificativi?.data_doc ?? "",
      "Fornitore": r.gal_giustificativi?.fornitore_denominazione ?? "",
      "Misura": r.misura,
      "Categoria": r.categoria_spesa,
      "Intervento": r.intervento ?? "",
      "Imponibile": r.imponibile_imputato,
      "IVA": r.iva_imputato,
      "Totale": r.totale_imputato,
      "Eleggibile": r.eleggibile ? "Sì" : "No",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Elenco");
    XLSX.writeFile(wb, `ses_elenco_${periodo?.codice ?? "report"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handlePdfReport() {
    if (!periodo) return;
    generateMultiSectionPdf(
      [
        {
          title: "Riepilogo per Categoria di Spesa",
          columns: [
            { header: "Categoria Spesa", dataKey: "categoria" },
            { header: "N. Righe", dataKey: "n_righe", width: 18, align: "right" },
            { header: "Imponibile", dataKey: "imponibile", width: 32, align: "right" },
            { header: "IVA", dataKey: "iva", width: 28, align: "right" },
            { header: "Totale", dataKey: "totale", width: 32, align: "right" },
          ],
          rows: riepilogo.map((r) => ({
            categoria: r.categoria_spesa,
            n_righe: String(r.n_righe),
            imponibile: pdfEur(r.imponibile),
            iva: pdfEur(r.iva),
            totale: pdfEur(r.totale),
          })),
          summary: [
            { label: "Totale spesa rendicontata", value: pdfEur(totRiepilogo) },
            { label: `Quota FEASR (${periodo.perc_feasr}%)`, value: pdfEur(quotaFeasr) },
            { label: `Quota Nazionale (${100 - periodo.perc_feasr}%)`, value: pdfEur(quotaNazionale) },
          ],
        },
        {
          title: "Elenco Fatture / Giustificativi",
          columns: [
            { header: "N. Doc", dataKey: "numero_doc", width: 26 },
            { header: "Data", dataKey: "data_doc", width: 20, align: "center" },
            { header: "Fornitore", dataKey: "fornitore" },
            { header: "Categoria", dataKey: "categoria", width: 34 },
            { header: "Intervento", dataKey: "intervento", width: 22 },
            { header: "Imponibile", dataKey: "imponibile", width: 26, align: "right" },
            { header: "Totale", dataKey: "totale", width: 26, align: "right" },
            { header: "Eleg.", dataKey: "eleggibile", width: 12, align: "center" },
          ],
          rows: righe.map((r: any) => ({
            numero_doc: r.gal_giustificativi?.numero_doc ?? "-",
            data_doc: pdfDate(r.gal_giustificativi?.data_doc),
            fornitore: r.gal_giustificativi?.fornitore_denominazione ?? "-",
            categoria: r.categoria_spesa,
            intervento: r.intervento ?? "-",
            imponibile: pdfEur(r.imponibile_imputato),
            totale: pdfEur(r.totale_imputato),
            eleggibile: r.eleggibile ? "✓" : "✗",
          })),
        },
      ],
      {
        title: `Report SES — ${periodo.codice}`,
        subtitle: `${periodo.descrizione} | Anno ${periodo.anno_riferimento ?? "-"} | Misura ${periodo.misura ?? "-"}`,
        galNome: currentGal?.nome ?? "GAL-OS",
        filename: `ses_${periodo.codice}_${new Date().toISOString().slice(0, 10)}.pdf`,
        orientation: "landscape",
        footerText: `Periodo SES: ${periodo.codice} — uso interno`,
      }
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Report SES / Periodi</h1>
          <p className="text-sm text-gray-500">Gestione periodi FEASR e rendicontazione SES</p>
        </div>
        {write && <button className="btn-primary" onClick={openCreate}><Plus size={16} /> Nuovo periodo</button>}
      </div>

      {/* Periodi list */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-700 text-white">
              <tr>
                <th className="px-3 py-2 text-left">Codice</th>
                <th className="px-3 py-2 text-left">Descrizione</th>
                <th className="px-3 py-2 text-left">Misura</th>
                <th className="px-3 py-2 text-left">Anno</th>
                <th className="px-3 py-2 text-right">% FEASR</th>
                <th className="px-3 py-2 text-center">Stato</th>
                {write && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {periodi.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Nessun periodo configurato</td></tr>
              )}
              {periodi.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${selectedPeriodo === p.id ? "bg-green-50" : ""}`}
                  onClick={() => setSelectedPeriodo(p.id)}
                >
                  <td className="px-3 py-2 font-mono font-semibold">{p.codice}</td>
                  <td className="px-3 py-2">{p.descrizione}</td>
                  <td className="px-3 py-2 text-xs">{p.misura ?? "-"}{p.sotto_misura ? `.${p.sotto_misura}` : ""}</td>
                  <td className="px-3 py-2 text-xs">{p.anno_riferimento ?? "-"}</td>
                  <td className="px-3 py-2 text-right">{p.perc_feasr}%</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`badge ${p.stato === "chiuso" ? "bg-gray-100 text-gray-600" : "bg-green-100 text-green-700"}`}>{p.stato}</span>
                  </td>
                  {write && (
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-end">
                        <button className="btn-ghost p-1 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(p); }}>Modifica</button>
                        <button className="btn-ghost p-1 text-xs text-red-500" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(p); }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Report area */}
      {selectedPeriodo && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText size={18} className="text-green-700" />
              Report: {periodo?.codice} — {periodo?.descrizione}
            </h2>
            <div className="flex gap-2">
              <button className="btn-secondary text-xs" onClick={handleExportRiepilogo}><Download size={14} /> Excel riepilogo</button>
              <button className="btn-secondary text-xs" onClick={handleExportElenco}><Download size={14} /> Excel elenco</button>
              <button className="btn-secondary text-xs" onClick={handlePdfReport}><FileDown size={14} /> PDF completo</button>
            </div>
          </div>

          {/* Funding breakdown */}
          {periodo && (
            <div className="grid grid-cols-3 gap-4">
              <div className="card p-4 border-l-4 border-green-600">
                <p className="text-xs text-gray-500">Totale spesa</p>
                <p className="text-xl font-bold">{formatCurrency(totRiepilogo)}</p>
              </div>
              <div className="card p-4 border-l-4 border-blue-600">
                <p className="text-xs text-gray-500">Quota FEASR ({periodo.perc_feasr}%)</p>
                <p className="text-xl font-bold text-blue-700">{formatCurrency(quotaFeasr)}</p>
              </div>
              <div className="card p-4 border-l-4 border-orange-500">
                <p className="text-xs text-gray-500">Quota Nazionale ({100 - periodo.perc_feasr}%)</p>
                <p className="text-xl font-bold text-orange-700">{formatCurrency(quotaNazionale)}</p>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-200">
            {(["riepilogo", "elenco"] as const).map((t) => (
              <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === t ? "border-green-600 text-green-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                {t === "riepilogo" ? "Riepilogo per categoria" : "Elenco fatture"}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-center text-gray-400 py-8">Caricamento...</p>
          ) : activeTab === "riepilogo" ? (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    <th className="px-3 py-2 text-left">Categoria Spesa</th>
                    <th className="px-3 py-2 text-right">N. Righe</th>
                    <th className="px-3 py-2 text-right">Imponibile</th>
                    <th className="px-3 py-2 text-right">IVA</th>
                    <th className="px-3 py-2 text-right">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {riepilogo.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Nessuna riga per questo periodo</td></tr>
                  )}
                  {riepilogo.map((r) => (
                    <tr key={r.categoria_spesa} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{r.categoria_spesa}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{r.n_righe}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(r.imponibile)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(r.iva)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatCurrency(r.totale)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-700 text-white">
                  <tr>
                    <td className="px-3 py-2 font-bold">TOTALE</td>
                    <td className="px-3 py-2 text-right font-bold">{riepilogo.reduce((s, r) => s + r.n_righe, 0)}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatCurrency(riepilogo.reduce((s, r) => s + r.imponibile, 0))}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatCurrency(riepilogo.reduce((s, r) => s + r.iva, 0))}</td>
                    <td className="px-3 py-2 text-right font-bold">{formatCurrency(totRiepilogo)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-700 text-white">
                    <tr>
                      <th className="px-3 py-2 text-left">N. Doc</th>
                      <th className="px-3 py-2 text-left">Data</th>
                      <th className="px-3 py-2 text-left">Fornitore</th>
                      <th className="px-3 py-2 text-left">Categoria</th>
                      <th className="px-3 py-2 text-left">Intervento</th>
                      <th className="px-3 py-2 text-right">Imponibile</th>
                      <th className="px-3 py-2 text-right">Totale</th>
                      <th className="px-3 py-2 text-center">Eleg.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {righe.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">Nessuna riga</td></tr>
                    )}
                    {righe.map((r: any) => (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs">{r.gal_giustificativi?.numero_doc ?? "-"}</td>
                        <td className="px-3 py-2 text-xs">{r.gal_giustificativi?.data_doc ?? "-"}</td>
                        <td className="px-3 py-2 text-xs">{r.gal_giustificativi?.fornitore_denominazione ?? "-"}</td>
                        <td className="px-3 py-2 text-xs">{r.categoria_spesa}</td>
                        <td className="px-3 py-2 text-xs">{r.intervento ?? "-"}</td>
                        <td className="px-3 py-2 text-right text-xs">{formatCurrency(r.imponibile_imputato)}</td>
                        <td className="px-3 py-2 text-right text-xs font-semibold">{formatCurrency(r.totale_imputato)}</td>
                        <td className="px-3 py-2 text-center text-xs">{r.eleggibile ? <span className="text-green-600">✓</span> : <span className="text-red-400">✗</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal periodo */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editPeriodo ? "Modifica Periodo" : "Nuovo Periodo SES"} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Codice *</label>
              <input className="input font-mono" required value={form.codice} onChange={(e) => setForm({ ...form, codice: e.target.value })} placeholder="es. 2023-01" /></div>
            <div><label className="label">Descrizione *</label>
              <input className="input" required value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Misura</label>
              <input className="input" value={form.misura} onChange={(e) => setForm({ ...form, misura: e.target.value })} placeholder="es. 19" /></div>
            <div><label className="label">Sotto-misura</label>
              <input className="input" value={form.sotto_misura} onChange={(e) => setForm({ ...form, sotto_misura: e.target.value })} placeholder="es. 2" /></div>
            <div><label className="label">Anno riferimento</label>
              <input className="input" type="number" value={form.anno_riferimento} onChange={(e) => setForm({ ...form, anno_riferimento: parseInt(e.target.value) || new Date().getFullYear() })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Data inizio</label>
              <input className="input" type="date" value={form.data_inizio} onChange={(e) => setForm({ ...form, data_inizio: e.target.value })} /></div>
            <div><label className="label">Data fine</label>
              <input className="input" type="date" value={form.data_fine} onChange={(e) => setForm({ ...form, data_fine: e.target.value })} /></div>
            <div><label className="label">% FEASR *</label>
              <input className="input" type="number" min={0} max={100} step={0.01} value={form.perc_feasr} onChange={(e) => setForm({ ...form, perc_feasr: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Stato</label>
              <select className="input" value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value })}>
                <option value="aperto">Aperto</option>
                <option value="chiuso">Chiuso</option>
              </select></div>
            <div><label className="label">Note</label>
              <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Elimina periodo"
        message={`Eliminare il periodo "${deleteConfirm?.codice}"? Le righe di imputazione associate non verranno eliminate.`}
        confirmLabel="Elimina"
        danger
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
