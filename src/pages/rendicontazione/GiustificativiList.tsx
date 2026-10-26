// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { readFatturaXml } from "../../lib/fatturaPA";
import { generateTablePdf, pdfEur, pdfDate } from "../../lib/pdf";
import { toast } from "sonner";
import { Plus, Search, Download, FileCode2, FileDown, Trash2 } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import * as XLSX from "xlsx";
import type { Giustificativo, Fornitore, Intervento, TipologiaSpesa, CapitoloLookup } from "../../types";

const STATO_COLORS: Record<string, string> = {
  da_pagare: "bg-yellow-100 text-yellow-700",
  pagata: "bg-green-100 text-green-700",
  parzialmente_pagata: "bg-blue-100 text-blue-700",
  annullata: "bg-red-100 text-red-600",
};

const FORM_INIT = {
  numero_doc: "", data_doc: "", tipo_doc: "fattura",
  fornitore_id: "", fornitore_denominazione: "", fornitore_piva: "",
  imponibile: 0, aliquota_iva: 22, cig: "", cup: "",
  intervento_id: "", tipologia_id: "", capitolo_id: "",
  intervento: "", tipologia_spesa: "", capitolo: "",
  note: "",
};

export default function GiustificativiList() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [giust, setGiust] = useState<Giustificativo[]>([]);
  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [interventi, setInterventi] = useState<Intervento[]>([]);
  const [allTipologie, setAllTipologie] = useState<TipologiaSpesa[]>([]);
  const [allCapitoli, setAllCapitoli] = useState<CapitoloLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statoFilter, setStatoFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const [xmlImporting, setXmlImporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Giustificativo | null>(null);

  const xmlInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    let q = supabase.from("gal_giustificativi").select("*").eq("gal_id", currentGal.id).order("data_doc", { ascending: false });
    if (statoFilter) q = q.eq("stato", statoFilter);
    const { data } = await q;
    setGiust((data ?? []) as Giustificativo[]);
    const [fRes, intRes, tipRes, capRes] = await Promise.all([
      supabase.from("gal_fornitori").select("id, denominazione, partita_iva").eq("gal_id", currentGal.id).order("denominazione"),
      supabase.from("gal_interventi").select("*").eq("gal_id", currentGal.id).order("nome"),
      supabase.from("gal_tipologie_spesa").select("*").eq("gal_id", currentGal.id).order("nome"),
      supabase.from("gal_capitoli").select("*").eq("gal_id", currentGal.id).order("nome"),
    ]);
    setFornitori((fRes.data ?? []) as Fornitore[]);
    setInterventi((intRes.data ?? []) as Intervento[]);
    setAllTipologie((tipRes.data ?? []) as TipologiaSpesa[]);
    setAllCapitoli((capRes.data ?? []) as CapitoloLookup[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id, statoFilter]);

  const filtered = search
    ? giust.filter((g) =>
        [g.numero_doc, g.fornitore_denominazione ?? "", g.cig ?? "", g.cup ?? ""]
          .some((v) => String(v).toLowerCase().includes(search.toLowerCase()))
      )
    : giust;

  const totaleImporto = filtered.reduce((s, g) => s + g.totale, 0);
  const totalePagato = filtered.reduce((s, g) => {
    if (g.stato === "pagata") return s + g.totale;
    return s;
  }, 0);

  /** Inserisce un giustificativo provando prima con tutti i campi, poi con i campi minimi in caso di errore schema */
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const imponibile = form.imponibile;
    const iva = imponibile * form.aliquota_iva / 100;

    // Payload completo con tutti i campi
    const fullPayload: Record<string, unknown> = {
      gal_id: currentGal.id,
      numero_doc: form.numero_doc,
      data_doc: form.data_doc,
      tipo_doc: form.tipo_doc,
      fornitore_id: form.fornitore_id || null,
      fornitore_denominazione: form.fornitore_denominazione || null,
      fornitore_piva: form.fornitore_piva || null,
      imponibile, iva, totale: imponibile + iva,
      aliquota_iva: form.aliquota_iva,
      cig: form.cig || null, cup: form.cup || null,
      intervento: form.intervento || null,
      tipologia_spesa: form.tipologia_spesa || null,
      capitolo: form.capitolo || null,
      stato: "da_pagare",
      note: form.note || null,
    };

    // Prova con payload completo
    let { error } = await supabase.from("gal_giustificativi").insert(fullPayload);

    // Se fallisce per colonna mancante, riprova con payload minimo
    if (error?.message?.includes("schema cache")) {
      const minPayload: Record<string, unknown> = {
        gal_id: currentGal.id,
        numero_doc: form.numero_doc,
        data_doc: form.data_doc,
        tipo_doc: form.tipo_doc,
        imponibile, iva, totale: imponibile + iva,
        stato: "da_pagare",
      };
      ({ error } = await supabase.from("gal_giustificativi").insert(minPayload));
      if (!error) {
        toast.info("Salvataggio parziale: esegui l'SQL per aggiungere le colonne mancanti al database");
      }
    }

    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "giustificativo", descrizione: form.numero_doc });
    toast.success("Giustificativo aggiunto");
    setShowModal(false); setSaving(false); setForm(FORM_INIT); load();
  }

  /** Gestisce l'import da file XML FatturaPA */
  async function handleXmlImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-selected
    e.target.value = "";

    setXmlImporting(true);
    try {
      const parsed = await readFatturaXml(file);

      // Cerca il fornitore in anagrafica per PIVA o CF
      let fornitoreId = "";
      let fornitoreNome = parsed.fornitore_denominazione;
      if (parsed.fornitore_piva || parsed.fornitore_cf) {
        const found = fornitori.find((f) =>
          (parsed.fornitore_piva && f.partita_iva === parsed.fornitore_piva) ||
          (parsed.fornitore_cf && f.partita_iva === parsed.fornitore_cf)
        );
        if (found) {
          fornitoreId = found.id;
          fornitoreNome = found.denominazione;
        } else if (currentGal && parsed.fornitore_denominazione) {
          // Fornitore non trovato: crealo automaticamente
          const { data: newF } = await supabase.from("gal_fornitori").insert({
            gal_id: currentGal.id,
            denominazione: parsed.fornitore_denominazione,
            partita_iva: parsed.fornitore_piva || parsed.fornitore_cf || null,
            indirizzo: parsed.fornitore_indirizzo ? `${parsed.fornitore_indirizzo}, ${parsed.fornitore_comune} ${parsed.fornitore_provincia}` : null,
          }).select("id, denominazione, partita_iva").single();
          if (newF) {
            fornitoreId = newF.id;
            fornitoreNome = newF.denominazione;
            setFornitori((prev) => [...prev, newF as typeof prev[0]]);
            toast.info(`Fornitore "${parsed.fornitore_denominazione}" creato in anagrafica`);
          }
        }
      }

      // Determina aliquota IVA (arrotonda al valore standard più vicino)
      const aliquoteStandard = [0, 4, 5, 10, 22];
      const aliquota = aliquoteStandard.reduce((prev, curr) =>
        Math.abs(curr - parsed.aliquota_iva) < Math.abs(prev - parsed.aliquota_iva) ? curr : prev, 22);

      // Pre-compila il form con i dati della fattura
      setForm({
        numero_doc: parsed.numero_doc,
        data_doc: parsed.data_doc,
        tipo_doc: parsed.tipo_doc === "nota_credito" ? "nota_credito" : "fattura_elettronica",
        fornitore_id: fornitoreId,
        fornitore_denominazione: fornitoreNome,
        fornitore_piva: parsed.fornitore_piva || parsed.fornitore_cf,
        imponibile: parsed.imponibile,
        aliquota_iva: aliquota,
        cig: parsed.cig,
        cup: parsed.cup,
        intervento_id: "", tipologia_id: "", capitolo_id: "",
        intervento: "", tipologia_spesa: "", capitolo: "",
        note: parsed.causale ? `Causale: ${parsed.causale}` : "",
      });

      setShowModal(true);
      toast.success(`Fattura ${parsed.numero_doc} importata — verifica i dati e salva`);
    } catch (err) {
      toast.error(messaggioErrore(err, "Impossibile leggere il file XML"));
    } finally {
      setXmlImporting(false);
    }
  }

  function handleExportExcel() {
    const rows = filtered.map((g) => ({
      "N. Documento": g.numero_doc,
      "Data": formatDate(g.data_doc),
      "Tipo": g.tipo_doc,
      "Fornitore": g.fornitore_denominazione ?? "",
      "Imponibile": g.imponibile,
      "IVA": g.iva,
      "Totale": g.totale,
      "CIG": g.cig ?? "",
      "Stato": g.stato,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Giustificativi");
    XLSX.writeFile(wb, `giustificativi_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleExportPdf() {
    generateTablePdf(
      [
        { header: "N. Documento", dataKey: "numero_doc", width: 28 },
        { header: "Data", dataKey: "data_doc", width: 22, align: "center" },
        { header: "Tipo", dataKey: "tipo_doc", width: 22 },
        { header: "Fornitore", dataKey: "fornitore" },
        { header: "Imponibile", dataKey: "imponibile", width: 24, align: "right" },
        { header: "IVA", dataKey: "iva", width: 20, align: "right" },
        { header: "Totale", dataKey: "totale", width: 24, align: "right" },
        { header: "CIG", dataKey: "cig", width: 22 },
        { header: "Stato", dataKey: "stato", width: 22 },
      ],
      filtered.map((g) => ({
        numero_doc: g.numero_doc,
        data_doc: pdfDate(g.data_doc),
        tipo_doc: g.tipo_doc.replace(/_/g, " "),
        fornitore: g.fornitore_denominazione ?? "-",
        imponibile: pdfEur(g.imponibile),
        iva: pdfEur(g.iva),
        totale: pdfEur(g.totale),
        cig: g.cig ?? "-",
        stato: g.stato.replace(/_/g, " "),
      })),
      {
        title: "Registro Giustificativi",
        subtitle: `${filtered.length} documenti — Tot. ${pdfEur(totaleImporto)} | Pagato: ${pdfEur(totalePagato)} | Da pagare: ${pdfEur(totaleImporto - totalePagato)}`,
        galNome: currentGal?.nome ?? "GAL-OS",
        filename: `giustificativi_${new Date().toISOString().slice(0, 10)}.pdf`,
        orientation: "landscape",
        footerText: "Registro Giustificativi — uso interno",
      }
    );
  }

  async function handleDeleteGiust(g: Giustificativo) {
    if (!currentGal || !user) return;
    // Elimina righe imputazione, documenti storage e record
    await supabase.from("gal_righe_imputazione").delete().eq("giustificativo_id", g.id);
    await supabase.from("gal_pagamenti_giust").delete().eq("giustificativo_id", g.id);
    // Elimina documenti da storage
    const { data: docs } = await supabase.from("gal_documenti_giustificativo").select("storage_path").eq("giustificativo_id", g.id);
    if (docs && docs.length > 0) {
      await supabase.storage.from("documenti_gal").remove(docs.map((d: { storage_path: string }) => d.storage_path));
      await supabase.from("gal_documenti_giustificativo").delete().eq("giustificativo_id", g.id);
    }
    const { error } = await supabase.from("gal_giustificativi").delete().eq("id", g.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "giustificativo", descrizione: `${g.numero_doc} eliminato definitivamente` });
    toast.success("Giustificativo eliminato definitivamente");
    setDeleteConfirm(null); load();
  }

  const columns: Column<Giustificativo>[] = [
    { key: "numero_doc", label: "N. Documento" },
    { key: "data_doc", label: "Data", render: (r) => formatDate(r.data_doc) },
    { key: "tipo_doc", label: "Tipo", render: (r) => <span className="badge bg-gray-100 text-gray-600 capitalize">{r.tipo_doc.replace(/_/g, " ")}</span> },
    { key: "fornitore_denominazione", label: "Fornitore", render: (r) => r.fornitore_denominazione ?? "-" },
    { key: "imponibile", label: "Imponibile", render: (r) => formatCurrency(r.imponibile) },
    { key: "totale", label: "Totale", render: (r) => <strong>{formatCurrency(r.totale)}</strong> },
    { key: "intervento", label: "Intervento", render: (r) => <span className="text-xs">{r.intervento ?? "—"}</span> },
    { key: "capitolo", label: "Capitolo", render: (r) => <span className="text-xs">{r.capitolo ?? "—"}</span> },
    { key: "stato", label: "Stato", render: (r) => (
      <div className="flex items-center gap-1">
        <span className={`badge ${STATO_COLORS[r.stato] ?? "bg-gray-100"}`}>{r.stato.replace(/_/g, " ")}</span>
        {r.stato === "annullata" && write && (
          <button className="p-1 text-red-500 hover:text-red-700" title="Elimina definitivamente" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(r); }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="space-y-4">
      {/* Intestino nascosto per upload XML */}
      <input
        ref={xmlInputRef}
        type="file"
        accept=".xml,.p7m"
        className="hidden"
        onChange={handleXmlImport}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Giustificativi</h1>
          <p className="text-sm text-gray-500">{filtered.length} documenti</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={handleExportExcel}>
            <Download size={16} /> Excel
          </button>
          <button className="btn-secondary" onClick={handleExportPdf}>
            <FileDown size={16} /> PDF
          </button>
          {write && (
            <button
              className="btn-secondary"
              onClick={() => xmlInputRef.current?.click()}
              disabled={xmlImporting}
              title="Importa Fattura Elettronica XML"
            >
              <FileCode2 size={16} /> {xmlImporting ? "Lettura..." : "Importa XML"}
            </button>
          )}
          {write && (
            <button className="btn-primary" onClick={() => { setForm(FORM_INIT); setShowModal(true); }}>
              <Plus size={16} /> Nuovo
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs text-gray-500">Totale importo</p><p className="text-xl font-bold">{formatCurrency(totaleImporto)}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Totale pagato</p><p className="text-xl font-bold text-green-700">{formatCurrency(totalePagato)}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Da pagare</p><p className="text-xl font-bold text-yellow-700">{formatCurrency(totaleImporto - totalePagato)}</p></div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Cerca n. documento, fornitore, CIG..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-44" value={statoFilter} onChange={(e) => setStatoFilter(e.target.value)}>
          <option value="">Tutti gli stati</option>
          <option value="da_pagare">Da pagare</option>
          <option value="parzialmente_pagata">Parzialmente pagata</option>
          <option value="pagata">Pagata</option>
          <option value="annullata">Annullata</option>
        </select>
      </div>

      <div className="card">
        <Table data={filtered} columns={columns} keyField="id" isLoading={loading}
          onRowClick={(r) => navigate(`/giustificativi/${r.id}`)} emptyMessage="Nessun giustificativo trovato" />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuovo Giustificativo" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">N. Documento *</label>
              <input className="input" required value={form.numero_doc} onChange={(e) => setForm({ ...form, numero_doc: e.target.value })} placeholder="FT/2024/001" /></div>
            <div><label className="label">Data *</label>
              <input className="input" type="date" required value={form.data_doc} onChange={(e) => setForm({ ...form, data_doc: e.target.value })} /></div>
            <div><label className="label">Tipo</label>
              <select className="input" value={form.tipo_doc} onChange={(e) => setForm({ ...form, tipo_doc: e.target.value })}>
                <option value="fattura">Fattura</option>
                <option value="fattura_elettronica">Fattura Elettronica</option>
                <option value="nota_credito">Nota credito</option>
                <option value="ricevuta">Ricevuta</option>
                <option value="busta_paga">Busta paga</option>
                <option value="f24">F24</option>
                <option value="altro">Altro</option>
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Fornitore da anagrafica</label>
              <select className="input" value={form.fornitore_id} onChange={(e) => {
                const f = fornitori.find((x) => x.id === e.target.value);
                setForm({ ...form, fornitore_id: e.target.value, fornitore_denominazione: f?.denominazione ?? "", fornitore_piva: f?.partita_iva ?? "" });
              }}>
                <option value="">-- Seleziona --</option>
                {fornitori.map((f) => <option key={f.id} value={f.id}>{f.denominazione}</option>)}
              </select></div>
            <div><label className="label">o inserisci denominazione</label>
              <input className="input" value={form.fornitore_denominazione} onChange={(e) => setForm({ ...form, fornitore_denominazione: e.target.value })} /></div>
          </div>
          {form.fornitore_piva && (
            <p className="text-xs text-gray-500">P.IVA fornitore: <span className="font-mono">{form.fornitore_piva}</span></p>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Imponibile (€) *</label>
              <input className="input" type="number" step="0.01" required value={form.imponibile}
                onChange={(e) => setForm({ ...form, imponibile: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Aliquota IVA %</label>
              <select className="input" value={form.aliquota_iva} onChange={(e) => setForm({ ...form, aliquota_iva: parseFloat(e.target.value) })}>
                <option value={0}>0%</option><option value={4}>4%</option><option value={5}>5%</option>
                <option value={10}>10%</option><option value={22}>22%</option>
              </select></div>
            <div><label className="label">IVA calcolata</label>
              <input className="input bg-gray-50" value={formatCurrency(form.imponibile * form.aliquota_iva / 100)} readOnly /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">CIG</label><input className="input font-mono" value={form.cig} onChange={(e) => setForm({ ...form, cig: e.target.value })} /></div>
            <div><label className="label">CUP</label><input className="input font-mono" value={form.cup} onChange={(e) => setForm({ ...form, cup: e.target.value })} /></div>
          </div>
          {/* Imputazione a previsione */}
          <div className="border-t pt-4 mt-2">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Imputazione a previsione</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Intervento</label>
                <select className="input" value={form.intervento_id} onChange={(e) => {
                  const int = interventi.find((i) => i.id === e.target.value);
                  setForm({ ...form, intervento_id: e.target.value, intervento: int?.nome ?? "", tipologia_id: "", tipologia_spesa: "", capitolo_id: "", capitolo: "" });
                }}>
                  <option value="">— Nessuno —</option>
                  {interventi.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Tipologia Spesa</label>
                <select className="input" value={form.tipologia_id} onChange={(e) => {
                  const tip = allTipologie.find((t) => t.id === e.target.value);
                  setForm({ ...form, tipologia_id: e.target.value, tipologia_spesa: tip?.nome ?? "", capitolo_id: "", capitolo: "" });
                }} disabled={!form.intervento_id}>
                  <option value="">— Seleziona —</option>
                  {allTipologie.filter((t) => t.intervento_id === form.intervento_id).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Capitolo</label>
                <select className="input" value={form.capitolo_id} onChange={(e) => {
                  const cap = allCapitoli.find((c) => c.id === e.target.value);
                  setForm({ ...form, capitolo_id: e.target.value, capitolo: cap?.nome ?? "" });
                }} disabled={!form.tipologia_id}>
                  <option value="">— Seleziona —</option>
                  {allCapitoli.filter((c) => c.tipologia_id === form.tipologia_id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Elimina giustificativo definitivamente"
        message={`Eliminare definitivamente il giustificativo "${deleteConfirm?.numero_doc}"? Verranno eliminati anche tutti i documenti allegati, le righe di imputazione e i pagamenti associati. Questa azione è irreversibile.`}
        confirmLabel="Elimina definitivamente"
        danger
        onConfirm={() => deleteConfirm && handleDeleteGiust(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
