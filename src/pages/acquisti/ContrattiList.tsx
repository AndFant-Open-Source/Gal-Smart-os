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
import { Plus, Search, Download, FileText, Upload, FileDown } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import { generateTablePdf, pdfEur, pdfDate } from "../../lib/pdf";
import * as XLSX from "xlsx";
import type { Contratto, Procedura, Intervento, TipologiaSpesa, CapitoloLookup } from "../../types";

const STATO_COLORS: Record<string, string> = {
  attivo: "bg-green-100 text-green-700",
  scaduto: "bg-yellow-100 text-yellow-700",
  risolto: "bg-red-100 text-red-600",
  annullato: "bg-gray-200 text-gray-500",
};

const TIPO_CONTRATTO_OPTIONS = [
  "Servizi", "Fornitura", "Lavori", "Incarico professionale",
  "Collaborazione", "Consulenza", "Locazione", "Altro",
];

const FORM_INIT = {
  numero: "", oggetto: "", contraente: "", partita_iva: "",
  tipo_contratto: "Servizi", importo: 0, data_stipula: new Date().toISOString().slice(0, 10),
  data_inizio: "", data_fine: "", procedura_id: "",
  intervento: "", tipologia_spesa: "", capitolo: "",
  cig: "", cup: "", note: "",
};

export default function ContrattiList() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [contratti, setContratti] = useState<Contratto[]>([]);
  const [procedure, setProcedure] = useState<Procedura[]>([]);
  const [interventi, setInterventi] = useState<Intervento[]>([]);
  const [allTipologie, setAllTipologie] = useState<TipologiaSpesa[]>([]);
  const [allCapitoli, setAllCapitoli] = useState<CapitoloLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statoFilter, setStatoFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    let q = supabase
      .from("gal_contratti")
      .select("*, procedura:gal_procedure(codice, oggetto)")
      .eq("gal_id", currentGal.id)
      .order("data_stipula", { ascending: false });
    if (statoFilter) q = q.eq("stato", statoFilter);
    const { data } = await q;
    setContratti((data ?? []) as Contratto[]);

    const [pRes, intRes, tipRes, capRes] = await Promise.all([
      supabase.from("gal_procedure").select("id, codice, oggetto").eq("gal_id", currentGal.id).order("codice"),
      supabase.from("gal_interventi").select("*").eq("gal_id", currentGal.id).order("nome"),
      supabase.from("gal_tipologie_spesa").select("*").eq("gal_id", currentGal.id).order("nome"),
      supabase.from("gal_capitoli").select("*").eq("gal_id", currentGal.id).order("nome"),
    ]);
    setProcedure((pRes.data ?? []) as Procedura[]);
    setInterventi((intRes.data ?? []) as Intervento[]);
    setAllTipologie((tipRes.data ?? []) as TipologiaSpesa[]);
    setAllCapitoli((capRes.data ?? []) as CapitoloLookup[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id, statoFilter]);

  const filtered = search
    ? contratti.filter((c) =>
        [c.numero, c.oggetto, c.contraente, c.cig ?? ""]
          .some((v) => v.toLowerCase().includes(search.toLowerCase()))
      )
    : contratti;

  const totaleImporti = filtered.reduce((s, c) => s + c.importo, 0);
  const totaleAttivi = filtered.filter((c) => c.stato === "attivo").length;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);

    let docPath: string | null = null;
    let docNome: string | null = null;

    // Upload documento se presente
    if (docFile) {
      const ext = docFile.name.split(".").pop() ?? "pdf";
      const storagePath = `contratti/${currentGal.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("documenti_gal").upload(storagePath, docFile);
      if (upErr) {
        toast.error(messaggioErrore(upErr, "Errore upload documento"));
        setSaving(false);
        return;
      }
      docPath = storagePath;
      docNome = docFile.name;
    }

    const { error } = await supabase.from("gal_contratti").insert({
      gal_id: currentGal.id,
      numero: form.numero,
      oggetto: form.oggetto,
      contraente: form.contraente,
      partita_iva: form.partita_iva || null,
      tipo_contratto: form.tipo_contratto || null,
      importo: form.importo,
      data_stipula: form.data_stipula,
      data_inizio: form.data_inizio || null,
      data_fine: form.data_fine || null,
      procedura_id: form.procedura_id || null,
      intervento: form.intervento || null,
      tipologia_spesa: form.tipologia_spesa || null,
      capitolo: form.capitolo || null,
      cig: form.cig || null,
      cup: form.cup || null,
      documento_path: docPath,
      documento_nome: docNome,
      stato: "attivo",
      note: form.note || null,
    });

    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "contratto", descrizione: `${form.numero} - ${form.oggetto}` });
    toast.success("Contratto registrato");
    setShowModal(false); setSaving(false); setForm(FORM_INIT); setDocFile(null); load();
  }

  async function handleViewDoc(c: Contratto) {
    if (!c.documento_path) { toast.error("Nessun documento allegato"); return; }
    const { data } = await supabase.storage.from("documenti_gal").createSignedUrl(c.documento_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Errore apertura documento");
  }

  function handleExportExcel() {
    const rows = filtered.map((c) => ({
      "Numero": c.numero, "Oggetto": c.oggetto, "Contraente": c.contraente,
      "P.IVA": c.partita_iva ?? "", "Tipo": c.tipo_contratto ?? "",
      "Importo": c.importo, "Data Stipula": formatDate(c.data_stipula),
      "Inizio": c.data_inizio ? formatDate(c.data_inizio) : "", "Fine": c.data_fine ? formatDate(c.data_fine) : "",
      "CIG": c.cig ?? "", "Stato": c.stato,
      "Procedura": c.procedura ? `${c.procedura.codice} - ${c.procedura.oggetto}` : "",
      "Intervento": c.intervento ?? "", "Capitolo": c.capitolo ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contratti");
    XLSX.writeFile(wb, `contratti_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleExportPdf() {
    generateTablePdf(
      [
        { header: "Numero", dataKey: "numero", width: 22 },
        { header: "Oggetto", dataKey: "oggetto" },
        { header: "Contraente", dataKey: "contraente", width: 30 },
        { header: "Tipo", dataKey: "tipo", width: 20 },
        { header: "Importo", dataKey: "importo", width: 22, align: "right" },
        { header: "Stipula", dataKey: "data_stipula", width: 20, align: "center" },
        { header: "Scadenza", dataKey: "data_fine", width: 20, align: "center" },
        { header: "CIG", dataKey: "cig", width: 20 },
        { header: "Stato", dataKey: "stato", width: 16 },
      ],
      filtered.map((c) => ({
        numero: c.numero, oggetto: c.oggetto, contraente: c.contraente,
        tipo: c.tipo_contratto ?? "-", importo: pdfEur(c.importo),
        data_stipula: pdfDate(c.data_stipula), data_fine: pdfDate(c.data_fine),
        cig: c.cig ?? "-", stato: c.stato,
      })),
      {
        title: "Registro Contratti",
        subtitle: `${filtered.length} contratti — Importo totale: ${pdfEur(totaleImporti)}`,
        galNome: currentGal?.nome ?? "GAL-OS",
        filename: `contratti_${new Date().toISOString().slice(0, 10)}.pdf`,
        orientation: "landscape",
        footerText: "Registro Contratti — uso interno",
      }
    );
  }

  // Cascading dropdowns per imputazione
  const filteredTipologie = form.intervento
    ? allTipologie.filter((t) => { const int = interventi.find((i) => i.nome === form.intervento); return int ? t.intervento_id === int.id : true; })
    : [];
  const filteredCapitoli = form.tipologia_spesa
    ? allCapitoli.filter((c) => { const tip = allTipologie.find((t) => t.nome === form.tipologia_spesa); return tip ? c.tipologia_id === tip.id : true; })
    : [];

  const columns: Column<Contratto>[] = [
    { key: "numero", label: "Numero" },
    { key: "oggetto", label: "Oggetto", render: (c) => <span className="font-medium">{c.oggetto.length > 40 ? c.oggetto.slice(0, 40) + "..." : c.oggetto}</span> },
    { key: "contraente", label: "Contraente" },
    { key: "tipo_contratto", label: "Tipo", render: (c) => <span className="text-xs">{c.tipo_contratto ?? "-"}</span> },
    { key: "importo", label: "Importo", render: (c) => <strong>{formatCurrency(c.importo)}</strong> },
    { key: "data_stipula", label: "Stipula", render: (c) => formatDate(c.data_stipula) },
    { key: "data_fine", label: "Scadenza", render: (c) => c.data_fine ? formatDate(c.data_fine) : "-" },
    { key: "documento_path", label: "Doc", render: (c) => c.documento_path ? (
      <button onClick={(e) => { e.stopPropagation(); handleViewDoc(c); }} className="text-blue-600 hover:text-blue-800" title="Visualizza contratto"><FileText size={16} /></button>
    ) : <span className="text-gray-300">—</span> },
    { key: "stato", label: "Stato", render: (c) => <span className={`badge ${STATO_COLORS[c.stato] ?? "bg-gray-100"}`}>{c.stato}</span> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Contratti</h1>
          <p className="text-sm text-gray-500">{filtered.length} contratti registrati</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={handleExportExcel}><Download size={16} /> Excel</button>
          <button className="btn-secondary" onClick={handleExportPdf}><FileDown size={16} /> PDF</button>
          {write && (
            <button className="btn-primary" onClick={() => { setForm(FORM_INIT); setDocFile(null); setShowModal(true); }}>
              <Plus size={16} /> Nuovo contratto
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs text-gray-500">Totale contratti</p><p className="text-xl font-bold">{filtered.length}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Contratti attivi</p><p className="text-xl font-bold text-green-700">{totaleAttivi}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Importo totale</p><p className="text-xl font-bold">{formatCurrency(totaleImporti)}</p></div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Cerca numero, oggetto, contraente, CIG..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-40" value={statoFilter} onChange={(e) => setStatoFilter(e.target.value)}>
          <option value="">Tutti gli stati</option>
          <option value="attivo">Attivo</option>
          <option value="scaduto">Scaduto</option>
          <option value="risolto">Risolto</option>
          <option value="annullato">Annullato</option>
        </select>
      </div>

      <div className="card">
        <Table data={filtered} columns={columns} keyField="id" isLoading={loading}
          onRowClick={(c) => navigate(`/contratti/${c.id}`)} emptyMessage="Nessun contratto trovato" />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuovo Contratto" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Numero *</label>
              <input className="input" required value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="CONTR-001/2025" /></div>
            <div><label className="label">Data stipula *</label>
              <input className="input" type="date" required value={form.data_stipula} onChange={(e) => setForm({ ...form, data_stipula: e.target.value })} /></div>
            <div><label className="label">Tipo contratto</label>
              <select className="input" value={form.tipo_contratto} onChange={(e) => setForm({ ...form, tipo_contratto: e.target.value })}>
                {TIPO_CONTRATTO_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
          </div>
          <div><label className="label">Oggetto *</label>
            <input className="input" required value={form.oggetto} onChange={(e) => setForm({ ...form, oggetto: e.target.value })} placeholder="Descrizione oggetto del contratto" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Contraente *</label>
              <input className="input" required value={form.contraente} onChange={(e) => setForm({ ...form, contraente: e.target.value })} placeholder="Ragione sociale / Nome e cognome" /></div>
            <div><label className="label">P.IVA / C.F.</label>
              <input className="input font-mono" value={form.partita_iva} onChange={(e) => setForm({ ...form, partita_iva: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Importo (€) *</label>
              <input className="input" type="number" step="0.01" required value={form.importo} onChange={(e) => setForm({ ...form, importo: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Data inizio</label>
              <input className="input" type="date" value={form.data_inizio} onChange={(e) => setForm({ ...form, data_inizio: e.target.value })} /></div>
            <div><label className="label">Data fine</label>
              <input className="input" type="date" value={form.data_fine} onChange={(e) => setForm({ ...form, data_fine: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">CIG</label><input className="input font-mono" value={form.cig} onChange={(e) => setForm({ ...form, cig: e.target.value })} /></div>
            <div><label className="label">CUP</label><input className="input font-mono" value={form.cup} onChange={(e) => setForm({ ...form, cup: e.target.value })} /></div>
          </div>

          {/* Collegamento procedura */}
          <div className="border-t pt-3">
            <label className="label">Collega a procedura (opzionale)</label>
            <select className="input" value={form.procedura_id} onChange={(e) => setForm({ ...form, procedura_id: e.target.value })}>
              <option value="">— Nessuna procedura —</option>
              {procedure.map((p) => <option key={p.id} value={p.id}>{p.codice ?? "—"} · {p.oggetto}</option>)}
            </select>
          </div>

          {/* Imputazione a previsione */}
          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Imputazione a previsione (opzionale)</p>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="label text-xs">Intervento</label>
                <select className="input text-sm" value={form.intervento} onChange={(e) => setForm({ ...form, intervento: e.target.value, tipologia_spesa: "", capitolo: "" })}>
                  <option value="">— Nessuno —</option>
                  {interventi.map((i) => <option key={i.id} value={i.nome}>{i.nome}</option>)}
                </select></div>
              <div><label className="label text-xs">Tipologia Spesa</label>
                <select className="input text-sm" value={form.tipologia_spesa} onChange={(e) => setForm({ ...form, tipologia_spesa: e.target.value, capitolo: "" })} disabled={!form.intervento}>
                  <option value="">— Seleziona —</option>
                  {filteredTipologie.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
                </select></div>
              <div><label className="label text-xs">Capitolo</label>
                <select className="input text-sm" value={form.capitolo} onChange={(e) => setForm({ ...form, capitolo: e.target.value })} disabled={!form.tipologia_spesa}>
                  <option value="">— Seleziona —</option>
                  {filteredCapitoli.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select></div>
            </div>
          </div>

          {/* Upload documento */}
          <div className="border-t pt-3">
            <label className="label">Allega contratto (PDF)</label>
            <div className="flex items-center gap-3">
              <label className="btn-secondary cursor-pointer">
                <Upload size={16} /> {docFile ? docFile.name : "Seleziona file"}
                <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
              </label>
              {docFile && <span className="text-xs text-gray-500">{(docFile.size / 1024).toFixed(0)} KB</span>}
            </div>
          </div>

          <div><label className="label">Note</label><textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "Salvataggio..." : "Registra contratto"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
