// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { Plus, Download, Trash2, Edit2, FileSpreadsheet, TrendingUp, Search, Settings } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import * as XLSX from "xlsx";
import type { VocePrevisione, Periodo, Intervento, TipologiaSpesa, CapitoloLookup } from "../../types";

const FORM_INIT = {
  periodo_id: "", intervento_id: "", tipologia_id: "", capitolo_id: "",
  intervento: "", tipologia_spesa: "", voce: "", capitolo: "",
  unita_misura: "", quantita: 0, costo_unitario: 0,
  spesa_imponibile: 0, importo_iva: 0, spesa_con_iva: 0,
  iva_applicabile: false, note: "",
};

export default function PrevisioneList() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  // Lookup data
  const [interventi, setInterventi] = useState<Intervento[]>([]);
  const [tipologie, setTipologie] = useState<TipologiaSpesa[]>([]);
  const [capitoli, setCapitoli] = useState<CapitoloLookup[]>([]);
  const [periodi, setPeriodi] = useState<Periodo[]>([]);

  // Voci
  const [voci, setVoci] = useState<VocePrevisione[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPeriodo, setSelectedPeriodo] = useState("");
  const [filterIntervento, setFilterIntervento] = useState("");
  const [search, setSearch] = useState("");

  // Form voce
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VocePrevisione | null>(null);
  const [form, setForm] = useState({ ...FORM_INIT });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<VocePrevisione | null>(null);

  // Gestione categorie
  const [showCategorieModal, setShowCategorieModal] = useState(false);
  const [catSelIntervento, setCatSelIntervento] = useState("");
  const [catSelTipologia, setCatSelTipologia] = useState("");
  const [newInterventoNome, setNewInterventoNome] = useState("");
  const [newTipologiaNome, setNewTipologiaNome] = useState("");
  const [newCapitoloNome, setNewCapitoloNome] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatNome, setEditingCatNome] = useState("");

  // ── Load lookup data ──────────────────────────────────────────
  useEffect(() => {
    if (!currentGal) return;
    loadLookups();
    supabase.from("gal_periodi_ses").select("*").eq("gal_id", currentGal.id).order("codice")
      .then(({ data }) => setPeriodi((data ?? []) as Periodo[]));
  }, [currentGal?.id]);

  async function loadLookups() {
    if (!currentGal) return;
    const [intRes, tipRes, capRes] = await Promise.all([
      supabase.from("gal_interventi").select("*").eq("gal_id", currentGal.id).order("nome"),
      supabase.from("gal_tipologie_spesa").select("*").eq("gal_id", currentGal.id).order("nome"),
      supabase.from("gal_capitoli").select("*").eq("gal_id", currentGal.id).order("nome"),
    ]);
    setInterventi((intRes.data ?? []) as Intervento[]);
    setTipologie((tipRes.data ?? []) as TipologiaSpesa[]);
    setCapitoli((capRes.data ?? []) as CapitoloLookup[]);
  }

  // ── Load voci ─────────────────────────────────────────────────
  async function load() {
    if (!currentGal) return;
    setLoading(true);
    let q = supabase.from("gal_voci_previsione").select("*").eq("gal_id", currentGal.id).order("intervento");
    if (selectedPeriodo) q = q.eq("periodo_id", selectedPeriodo);
    if (filterIntervento) q = q.eq("intervento", filterIntervento);
    const { data } = await q;
    setVoci((data ?? []) as VocePrevisione[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id, selectedPeriodo, filterIntervento]);

  // ── Filter & pivot ────────────────────────────────────────────
  const filtered = search
    ? voci.filter((v) => [v.intervento, v.tipologia_spesa, v.voce, v.capitolo].some((s) => s.toLowerCase().includes(search.toLowerCase())))
    : voci;

  const pivot = filtered.reduce<Record<string, Record<string, VocePrevisione[]>>>((acc, v) => {
    if (!acc[v.intervento]) acc[v.intervento] = {};
    if (!acc[v.intervento][v.tipologia_spesa]) acc[v.intervento][v.tipologia_spesa] = [];
    acc[v.intervento][v.tipologia_spesa].push(v);
    return acc;
  }, {});

  const totPrevisto = filtered.reduce((s, v) => s + v.spesa_imponibile, 0);
  const totPrevistoConIva = filtered.reduce((s, v) => s + v.spesa_con_iva, 0);
  const intervalliDisponibili = [...new Set(voci.map((v) => v.intervento))].sort();

  // ── Gestione categorie ────────────────────────────────────────
  async function addIntervento() {
    if (!currentGal || !newInterventoNome.trim()) return;
    const { error } = await supabase.from("gal_interventi").insert({ gal_id: currentGal.id, nome: newInterventoNome.trim() });
    if (error) { toast.error(messaggioErrore(error)); return; }
    setNewInterventoNome("");
    toast.success("Intervento aggiunto");
    loadLookups();
  }

  async function deleteIntervento(id: string) {
    const { error } = await supabase.from("gal_interventi").delete().eq("id", id);
    if (error) { toast.error("Errore: impossibile eliminare (ci sono tipologie collegate?)"); return; }
    if (catSelIntervento === id) { setCatSelIntervento(""); setCatSelTipologia(""); }
    toast.success("Intervento eliminato");
    loadLookups();
  }

  async function addTipologia() {
    if (!currentGal || !catSelIntervento || !newTipologiaNome.trim()) return;
    const { error } = await supabase.from("gal_tipologie_spesa").insert({ gal_id: currentGal.id, intervento_id: catSelIntervento, nome: newTipologiaNome.trim() });
    if (error) { toast.error(messaggioErrore(error)); return; }
    setNewTipologiaNome("");
    toast.success("Tipologia aggiunta");
    loadLookups();
  }

  async function deleteTipologia(id: string) {
    const { error } = await supabase.from("gal_tipologie_spesa").delete().eq("id", id);
    if (error) { toast.error("Errore: impossibile eliminare (ci sono capitoli collegati?)"); return; }
    if (catSelTipologia === id) setCatSelTipologia("");
    toast.success("Tipologia eliminata");
    loadLookups();
  }

  async function addCapitolo() {
    if (!currentGal || !catSelTipologia || !newCapitoloNome.trim()) return;
    const { error } = await supabase.from("gal_capitoli").insert({ gal_id: currentGal.id, tipologia_id: catSelTipologia, nome: newCapitoloNome.trim() });
    if (error) { toast.error(messaggioErrore(error)); return; }
    setNewCapitoloNome("");
    toast.success("Capitolo aggiunto");
    loadLookups();
  }

  async function deleteCapitolo(id: string) {
    const { error } = await supabase.from("gal_capitoli").delete().eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Capitolo eliminato");
    loadLookups();
  }

  async function renameCategory(table: string, id: string, nome: string) {
    if (!nome.trim()) return;
    const { error } = await supabase.from(table).update({ nome: nome.trim() }).eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    setEditingCatId(null);
    setEditingCatNome("");
    toast.success("Nome aggiornato");
    loadLookups();
  }

  function startEditCat(id: string, nome: string) {
    setEditingCatId(id);
    setEditingCatNome(nome);
  }

  // ── Voce CRUD ─────────────────────────────────────────────────
  function calcSpesa() {
    const imp = form.quantita * form.costo_unitario;
    const iva = form.iva_applicabile ? imp * 0.22 : 0;
    setForm((f) => ({ ...f, spesa_imponibile: imp, importo_iva: iva, spesa_con_iva: imp + iva }));
  }

  // Cascading: when intervento changes, reset tipologia and capitolo
  function handleFormInterventoChange(interventoId: string) {
    const int = interventi.find((i) => i.id === interventoId);
    setForm((f) => ({ ...f, intervento_id: interventoId, intervento: int?.nome ?? "", tipologia_id: "", tipologia_spesa: "", capitolo_id: "", capitolo: "" }));
  }

  function handleFormTipologiaChange(tipologiaId: string) {
    const tip = tipologie.find((t) => t.id === tipologiaId);
    setForm((f) => ({ ...f, tipologia_id: tipologiaId, tipologia_spesa: tip?.nome ?? "", capitolo_id: "", capitolo: "" }));
  }

  function handleFormCapitoloChange(capitoloId: string) {
    const cap = capitoli.find((c) => c.id === capitoloId);
    setForm((f) => ({ ...f, capitolo_id: capitoloId, capitolo: cap?.nome ?? "" }));
  }

  const formTipologie = tipologie.filter((t) => t.intervento_id === form.intervento_id);
  const formCapitoli = capitoli.filter((c) => c.tipologia_id === form.tipologia_id);

  function openCreate() {
    setEditing(null);
    setForm({ ...FORM_INIT, periodo_id: selectedPeriodo });
    setShowModal(true);
  }

  function openEdit(v: VocePrevisione) {
    setEditing(v);
    // Find matching IDs from lookup tables
    const int = interventi.find((i) => i.nome === v.intervento);
    const tip = int ? tipologie.find((t) => t.intervento_id === int.id && t.nome === v.tipologia_spesa) : undefined;
    const cap = tip ? capitoli.find((c) => c.tipologia_id === tip.id && c.nome === v.capitolo) : undefined;
    setForm({
      periodo_id: v.periodo_id ?? "",
      intervento_id: int?.id ?? "", tipologia_id: tip?.id ?? "", capitolo_id: cap?.id ?? "",
      intervento: v.intervento, tipologia_spesa: v.tipologia_spesa,
      voce: v.voce, capitolo: v.capitolo,
      unita_misura: v.unita_misura ?? "", quantita: v.quantita, costo_unitario: v.costo_unitario,
      spesa_imponibile: v.spesa_imponibile, importo_iva: v.importo_iva, spesa_con_iva: v.spesa_con_iva,
      iva_applicabile: v.iva_applicabile, note: v.note ?? "",
    });
    setShowModal(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    if (!form.intervento || !form.tipologia_spesa || !form.capitolo) {
      toast.error("Seleziona Intervento, Tipologia e Capitolo");
      return;
    }
    setSaving(true);
    const payload = {
      gal_id: currentGal.id,
      periodo_id: form.periodo_id || null,
      intervento: form.intervento, tipologia_spesa: form.tipologia_spesa,
      voce: form.voce || form.capitolo, capitolo: form.capitolo,
      unita_misura: form.unita_misura || null,
      quantita: form.quantita, costo_unitario: form.costo_unitario,
      spesa_imponibile: form.spesa_imponibile, importo_iva: form.importo_iva, spesa_con_iva: form.spesa_con_iva,
      iva_applicabile: form.iva_applicabile, note: form.note || null,
    };
    let error;
    if (editing) {
      ({ error } = await supabase.from("gal_voci_previsione").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await supabase.from("gal_voci_previsione").insert(payload));
    }
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: editing ? "UPDATE" : "CREATE", entita: "voce_previsione", descrizione: `${form.intervento} - ${form.capitolo}` });
    toast.success(editing ? "Voce aggiornata" : "Voce aggiunta");
    setShowModal(false); setSaving(false); setEditing(null); load();
  }

  async function handleDelete(v: VocePrevisione) {
    if (!currentGal || !user) return;
    const { error } = await supabase.from("gal_voci_previsione").delete().eq("id", v.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Voce eliminata");
    setDeleteConfirm(null); load();
  }

  function handleExport() {
    const rows = filtered.map((v) => ({
      "Intervento": v.intervento, "Tipologia Spesa": v.tipologia_spesa,
      "Voce": v.voce, "Capitolo": v.capitolo,
      "U.M.": v.unita_misura ?? "", "Quantità": v.quantita,
      "Costo Unit.": v.costo_unitario, "Imponibile": v.spesa_imponibile,
      "IVA": v.importo_iva, "Con IVA": v.spesa_con_iva,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Previsione");
    XLSX.writeFile(wb, `previsione_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Filtered tipologie/capitoli for categorie modal
  const catTipologieFilt = tipologie.filter((t) => t.intervento_id === catSelIntervento);
  const catCapitoliFilt = capitoli.filter((c) => c.tipologia_id === catSelTipologia);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Previsione Budget</h1>
          <p className="text-sm text-gray-500">Piano finanziario autorizzato per voce e capitolo</p>
        </div>
        <div className="flex gap-2">
          {write && <button className="btn-secondary" onClick={() => setShowCategorieModal(true)}><Settings size={16} /> Gestione Categorie</button>}
          <button className="btn-secondary" onClick={handleExport}><Download size={16} /> Export Excel</button>
          {write && <button className="btn-primary" onClick={openCreate}><Plus size={16} /> Nuova voce</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4 border-l-4 border-blue-500"><p className="text-xs text-gray-500">Totale Previsto (imponibile)</p><p className="text-lg font-bold">{formatCurrency(totPrevisto)}</p></div>
        <div className="card p-4 border-l-4 border-purple-500"><p className="text-xs text-gray-500">Totale Previsto (con IVA)</p><p className="text-lg font-bold">{formatCurrency(totPrevistoConIva)}</p></div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select className="input w-64" value={selectedPeriodo} onChange={(e) => setSelectedPeriodo(e.target.value)}>
          <option value="">Tutti i periodi</option>
          {periodi.map((p) => <option key={p.id} value={p.id}>{p.codice} — {p.descrizione}</option>)}
        </select>
        <select className="input w-48" value={filterIntervento} onChange={(e) => setFilterIntervento(e.target.value)}>
          <option value="">Tutti gli interventi</option>
          {intervalliDisponibili.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Cerca voce, capitolo..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {loading && <div className="text-center py-8 text-gray-400">Caricamento...</div>}

      {/* ── Tabella pivot ────────────────────────────────────────── */}
      {!loading && Object.entries(pivot).map(([intervento, tipologieMap]) => {
        const allRighe = Object.values(tipologieMap).flat();
        const totIntImp = allRighe.reduce((s, v) => s + v.spesa_imponibile, 0);
        const totIntIva = allRighe.reduce((s, v) => s + v.spesa_con_iva, 0);
        return (
          <div key={intervento} className="card overflow-hidden">
            <div className="bg-slate-700 text-white px-4 py-2 flex items-center justify-between">
              <span className="font-semibold">{intervento}</span>
              <div className="flex items-center gap-4 text-sm">
                <span>Previsto: <strong>{formatCurrency(totIntImp)}</strong></span>
                <TrendingUp size={14} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table-auto w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-xs uppercase">
                    <th className="px-3 py-2 text-left">Capitolo</th>
                    <th className="px-3 py-2 text-left">Voce</th>
                    <th className="px-3 py-2 text-right">U.M.</th>
                    <th className="px-3 py-2 text-right">Qt.</th>
                    <th className="px-3 py-2 text-right">Costo Unit.</th>
                    <th className="px-3 py-2 text-right">Imponibile</th>
                    <th className="px-3 py-2 text-right">IVA</th>
                    <th className="px-3 py-2 text-right">Con IVA</th>
                    {write && <th className="px-3 py-2 text-center">Azioni</th>}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(tipologieMap).map(([tipologia, rows]) => {
                    const totTipImp = rows.reduce((s, v) => s + v.spesa_imponibile, 0);
                    const totTipConIva = rows.reduce((s, v) => s + v.spesa_con_iva, 0);
                    return (
                      <React.Fragment key={tipologia}>
                        <tr className="bg-blue-50 border-t border-blue-200">
                          <td colSpan={5} className="px-3 py-1.5 font-semibold text-blue-800 text-xs uppercase">{tipologia}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-blue-800 text-xs">{formatCurrency(totTipImp)}</td>
                          <td className="px-3 py-1.5"></td>
                          <td className="px-3 py-1.5 text-right font-semibold text-blue-800 text-xs">{formatCurrency(totTipConIva)}</td>
                          {write && <td></td>}
                        </tr>
                        {rows.map((v) => (
                          <tr key={v.id} className="hover:bg-gray-50 border-b border-gray-100">
                            <td className="px-3 py-2 pl-6 font-medium">{v.capitolo}</td>
                            <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate" title={v.voce}>{v.voce}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{v.unita_misura ?? "—"}</td>
                            <td className="px-3 py-2 text-right">{v.quantita > 0 ? v.quantita : "—"}</td>
                            <td className="px-3 py-2 text-right">{v.costo_unitario > 0 ? formatCurrency(v.costo_unitario) : "—"}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatCurrency(v.spesa_imponibile)}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{v.iva_applicabile ? formatCurrency(v.importo_iva) : "—"}</td>
                            <td className="px-3 py-2 text-right">{formatCurrency(v.spesa_con_iva)}</td>
                            {write && (
                              <td className="px-3 py-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button className="p-1 text-gray-400 hover:text-blue-600" onClick={() => openEdit(v)}><Edit2 size={14} /></button>
                                  {admin && <button className="p-1 text-gray-400 hover:text-red-600" onClick={() => setDeleteConfirm(v)}><Trash2 size={14} /></button>}
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-semibold text-sm">
                    <td colSpan={5} className="px-3 py-2 text-right text-gray-700">Totale {intervento}:</td>
                    <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(totIntImp)}</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(totIntIva)}</td>
                    {write && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {!loading && filtered.length === 0 && (
        <div className="card p-12 text-center text-gray-400">
          <FileSpreadsheet size={48} className="mx-auto mb-3 opacity-30" />
          <p>Nessuna voce di previsione trovata</p>
          <p className="text-sm mt-1">Crea prima le categorie con "Gestione Categorie", poi aggiungi le voci</p>
        </div>
      )}

      {/* ── Modal Nuova/Modifica Voce ────────────────────────────── */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? "Modifica Voce Previsione" : "Nuova Voce Previsione"} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Periodo</label>
              <select className="input" value={form.periodo_id} onChange={(e) => setForm({ ...form, periodo_id: e.target.value })}>
                <option value="">— Nessun periodo —</option>
                {periodi.map((p) => <option key={p.id} value={p.id}>{p.codice} — {p.descrizione}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Intervento *</label>
              <select className="input" required value={form.intervento_id} onChange={(e) => handleFormInterventoChange(e.target.value)}>
                <option value="">— Seleziona intervento —</option>
                {interventi.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Tipologia Spesa *</label>
              <select className="input" required value={form.tipologia_id} onChange={(e) => handleFormTipologiaChange(e.target.value)} disabled={!form.intervento_id}>
                <option value="">— Seleziona tipologia —</option>
                {formTipologie.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Capitolo *</label>
              <select className="input" required value={form.capitolo_id} onChange={(e) => handleFormCapitoloChange(e.target.value)} disabled={!form.tipologia_id}>
                <option value="">— Seleziona capitolo —</option>
                {formCapitoli.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          </div>
          <div><label className="label">Descrizione / Note voce</label>
            <textarea className="input" rows={2} value={form.voce} onChange={(e) => setForm({ ...form, voce: e.target.value })} placeholder="Dettaglio aggiuntivo (opzionale)" /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Unita di Misura</label><input className="input" value={form.unita_misura} onChange={(e) => setForm({ ...form, unita_misura: e.target.value })} placeholder="es. Ore/Uomo, Forfait" /></div>
            <div><label className="label">Quantita</label><input className="input" type="number" step="0.01" value={form.quantita} onChange={(e) => setForm({ ...form, quantita: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Costo Unitario (EUR)</label><input className="input" type="number" step="0.01" value={form.costo_unitario} onChange={(e) => setForm({ ...form, costo_unitario: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div className="flex gap-2 items-center">
            <button type="button" className="btn-secondary text-sm" onClick={calcSpesa}>Ricalcola da Qt x Costo</button>
            <label className="flex items-center gap-2 ml-4">
              <input type="checkbox" checked={form.iva_applicabile} onChange={(e) => setForm({ ...form, iva_applicabile: e.target.checked })} />
              <span className="text-sm">IVA applicabile (22%)</span>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Spesa Imponibile (EUR) *</label><input className="input" type="number" step="0.01" required value={form.spesa_imponibile} onChange={(e) => setForm({ ...form, spesa_imponibile: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">IVA (EUR)</label><input className="input" type="number" step="0.01" value={form.importo_iva} onChange={(e) => setForm({ ...form, importo_iva: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Spesa con IVA (EUR)</label><input className="input" type="number" step="0.01" value={form.spesa_con_iva} onChange={(e) => setForm({ ...form, spesa_con_iva: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      {/* ── Modal Gestione Categorie ─────────────────────────────── */}
      <Modal open={showCategorieModal} onClose={() => setShowCategorieModal(false)} title="Gestione Categorie" size="xl">
        <div className="grid grid-cols-3 gap-4 min-h-[400px]">
          {/* Colonna 1: Interventi */}
          <div className="border rounded-lg overflow-hidden flex flex-col">
            <div className="bg-slate-700 text-white px-3 py-2 text-sm font-semibold">Interventi</div>
            <div className="flex-1 overflow-y-auto divide-y">
              {interventi.map((i) => (
                <div key={i.id}
                  className={`px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 text-sm ${catSelIntervento === i.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`}
                  onClick={() => { setCatSelIntervento(i.id); setCatSelTipologia(""); }}
                >
                  {editingCatId === i.id ? (
                    <input className="input text-sm flex-1 mr-1" autoFocus value={editingCatNome} onChange={(e) => setEditingCatNome(e.target.value)}
                      onBlur={() => renameCategory("gal_interventi", i.id, editingCatNome)}
                      onKeyDown={(e) => { if (e.key === "Enter") renameCategory("gal_interventi", i.id, editingCatNome); if (e.key === "Escape") setEditingCatId(null); }}
                      onClick={(e) => e.stopPropagation()} />
                  ) : (
                    <span className="truncate">{i.nome}</span>
                  )}
                  {admin && editingCatId !== i.id && (
                    <div className="flex gap-0.5 flex-shrink-0">
                      <button className="p-1 text-gray-300 hover:text-blue-500" onClick={(e) => { e.stopPropagation(); startEditCat(i.id, i.nome); }}><Edit2 size={12} /></button>
                      <button className="p-1 text-gray-300 hover:text-red-500" onClick={(e) => { e.stopPropagation(); deleteIntervento(i.id); }}><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
              ))}
              {interventi.length === 0 && <p className="p-3 text-xs text-gray-400 text-center">Nessun intervento</p>}
            </div>
            <div className="border-t p-2 flex gap-1">
              <input className="input text-sm flex-1" placeholder="Nuovo intervento..." value={newInterventoNome} onChange={(e) => setNewInterventoNome(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addIntervento()} />
              <button className="btn-primary text-xs px-2" onClick={addIntervento}><Plus size={14} /></button>
            </div>
          </div>

          {/* Colonna 2: Tipologie Spesa */}
          <div className="border rounded-lg overflow-hidden flex flex-col">
            <div className="bg-blue-600 text-white px-3 py-2 text-sm font-semibold">
              Tipologie Spesa
              {catSelIntervento && <span className="font-normal text-blue-200 ml-1 text-xs">({interventi.find((i) => i.id === catSelIntervento)?.nome})</span>}
            </div>
            <div className="flex-1 overflow-y-auto divide-y">
              {!catSelIntervento ? (
                <p className="p-3 text-xs text-gray-400 text-center">Seleziona un intervento</p>
              ) : catTipologieFilt.length === 0 ? (
                <p className="p-3 text-xs text-gray-400 text-center">Nessuna tipologia</p>
              ) : catTipologieFilt.map((t) => (
                <div key={t.id}
                  className={`px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 text-sm ${catSelTipologia === t.id ? "bg-blue-50 border-l-4 border-blue-500" : ""}`}
                  onClick={() => setCatSelTipologia(t.id)}
                >
                  {editingCatId === t.id ? (
                    <input className="input text-sm flex-1 mr-1" autoFocus value={editingCatNome} onChange={(e) => setEditingCatNome(e.target.value)}
                      onBlur={() => renameCategory("gal_tipologie_spesa", t.id, editingCatNome)}
                      onKeyDown={(e) => { if (e.key === "Enter") renameCategory("gal_tipologie_spesa", t.id, editingCatNome); if (e.key === "Escape") setEditingCatId(null); }}
                      onClick={(e) => e.stopPropagation()} />
                  ) : (
                    <span className="truncate">{t.nome}</span>
                  )}
                  {admin && editingCatId !== t.id && (
                    <div className="flex gap-0.5 flex-shrink-0">
                      <button className="p-1 text-gray-300 hover:text-blue-500" onClick={(e) => { e.stopPropagation(); startEditCat(t.id, t.nome); }}><Edit2 size={12} /></button>
                      <button className="p-1 text-gray-300 hover:text-red-500" onClick={(e) => { e.stopPropagation(); deleteTipologia(t.id); }}><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {catSelIntervento && (
              <div className="border-t p-2 flex gap-1">
                <input className="input text-sm flex-1" placeholder="Nuova tipologia..." value={newTipologiaNome} onChange={(e) => setNewTipologiaNome(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTipologia()} />
                <button className="btn-primary text-xs px-2" onClick={addTipologia}><Plus size={14} /></button>
              </div>
            )}
          </div>

          {/* Colonna 3: Capitoli */}
          <div className="border rounded-lg overflow-hidden flex flex-col">
            <div className="bg-green-600 text-white px-3 py-2 text-sm font-semibold">
              Capitoli
              {catSelTipologia && <span className="font-normal text-green-200 ml-1 text-xs">({tipologie.find((t) => t.id === catSelTipologia)?.nome})</span>}
            </div>
            <div className="flex-1 overflow-y-auto divide-y">
              {!catSelTipologia ? (
                <p className="p-3 text-xs text-gray-400 text-center">Seleziona una tipologia</p>
              ) : catCapitoliFilt.length === 0 ? (
                <p className="p-3 text-xs text-gray-400 text-center">Nessun capitolo</p>
              ) : catCapitoliFilt.map((c) => (
                <div key={c.id} className="px-3 py-2 flex items-center justify-between text-sm">
                  {editingCatId === c.id ? (
                    <input className="input text-sm flex-1 mr-1" autoFocus value={editingCatNome} onChange={(e) => setEditingCatNome(e.target.value)}
                      onBlur={() => renameCategory("gal_capitoli", c.id, editingCatNome)}
                      onKeyDown={(e) => { if (e.key === "Enter") renameCategory("gal_capitoli", c.id, editingCatNome); if (e.key === "Escape") setEditingCatId(null); }}
                      onClick={(e) => e.stopPropagation()} />
                  ) : (
                    <span className="truncate">{c.nome}</span>
                  )}
                  {admin && editingCatId !== c.id && (
                    <div className="flex gap-0.5 flex-shrink-0">
                      <button className="p-1 text-gray-300 hover:text-blue-500" onClick={(e) => { e.stopPropagation(); startEditCat(c.id, c.nome); }}><Edit2 size={12} /></button>
                      <button className="p-1 text-gray-300 hover:text-red-500" onClick={() => deleteCapitolo(c.id)}><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {catSelTipologia && (
              <div className="border-t p-2 flex gap-1">
                <input className="input text-sm flex-1" placeholder="Nuovo capitolo..." value={newCapitoloNome} onChange={(e) => setNewCapitoloNome(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCapitolo()} />
                <button className="btn-primary text-xs px-2" onClick={addCapitolo}><Plus size={14} /></button>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end pt-4">
          <button className="btn-secondary" onClick={() => setShowCategorieModal(false)}>Chiudi</button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteConfirm} title="Elimina voce" message={`Eliminare "${deleteConfirm?.capitolo}"?`} confirmLabel="Elimina" danger onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  );
}
