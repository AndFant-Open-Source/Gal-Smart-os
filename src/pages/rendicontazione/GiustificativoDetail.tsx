// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Plus, Edit2, Trash2, Ban, Upload, Download, FileText, Link2, ExternalLink, PackageOpen } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import JSZip from "jszip";
import type { Giustificativo, PagamentoGiustificativo, RigaImputazione, VocePrevisione, Periodo, Procedura, DocumentoGiustificativo, Intervento, TipologiaSpesa, CapitoloLookup } from "../../types";

const STATO_COLORS: Record<string, string> = {
  da_pagare: "bg-yellow-100 text-yellow-700",
  pagata: "bg-green-100 text-green-700",
  parzialmente_pagata: "bg-blue-100 text-blue-700",
  annullata: "bg-red-100 text-red-600",
};

const TIPO_ACCONTO_LABELS: Record<string, string> = {
  i_acconto: "I Acconto", ii_acconto: "II Acconto", saldo: "Saldo",
};

const TIPO_DOC_LABELS: Record<string, string> = {
  xml: "XML Fattura Elettronica",
  fattura_cartacea: "Fattura PDF / Cartacea",
  mandato_pagamento: "Mandato di Pagamento",
  bonifico: "Bonifico / Giustificativo Pagamento",
  f24: "Modello F24",
  altro: "Altro documento",
};

const TIPO_DOC_COLORS: Record<string, string> = {
  xml: "bg-purple-50 text-purple-700 border-purple-200",
  fattura_cartacea: "bg-blue-50 text-blue-700 border-blue-200",
  mandato_pagamento: "bg-orange-50 text-orange-700 border-orange-200",
  bonifico: "bg-green-50 text-green-700 border-green-200",
  f24: "bg-red-50 text-red-700 border-red-200",
  altro: "bg-gray-50 text-gray-600 border-gray-200",
};

const EMPTY_RIGA = {
  misura: "", sotto_misura: "", categoria_spesa: "spese_personale",
  imponibile_imputato: 0, iva_imputato: 0, eleggibile: true, note: "",
  periodo_id: "", intervento: "", tipologia_spesa: "", voce: "", capitolo: "",
  voce_previsione_id: "", tipo_acconto: "",
  imponibile_richiesto: null as number | null,
  iva_richiesta: null as number | null,
  totale_richiesto: null as number | null,
};

const EMPTY_PAG = {
  data_pagamento: new Date().toISOString().slice(0, 10),
  importo: 0, modalita: "bonifico", riferimento: "", note: "",
};

export default function GiustificativoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [giust, setGiust] = useState<Giustificativo | null>(null);
  const [pagamenti, setPagamenti] = useState<PagamentoGiustificativo[]>([]);
  const [righe, setRighe] = useState<RigaImputazione[]>([]);
  const [documenti, setDocumenti] = useState<DocumentoGiustificativo[]>([]);
  const [vociPrevisione, setVociPrevisione] = useState<VocePrevisione[]>([]);
  const [periodi, setPeriodi] = useState<Periodo[]>([]);
  const [procedure, setProcedure] = useState<Procedura[]>([]);
  const [interventi, setInterventi] = useState<Intervento[]>([]);
  const [allTipologie, setAllTipologie] = useState<TipologiaSpesa[]>([]);
  const [allCapitoli, setAllCapitoli] = useState<CapitoloLookup[]>([]);
  const [loading, setLoading] = useState(true);

  const [showPagModal, setShowPagModal] = useState(false);
  const [editingPagId, setEditingPagId] = useState<string | null>(null);
  const [pagForm, setPagForm] = useState(EMPTY_PAG);

  const [showRigaModal, setShowRigaModal] = useState(false);
  const [editingRigaId, setEditingRigaId] = useState<string | null>(null);
  const [rigaForm, setRigaForm] = useState({ ...EMPTY_RIGA });

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    numero_doc: "", data_doc: "", tipo_doc: "fattura",
    fornitore_denominazione: "", fornitore_piva: "",
    imponibile: 0, aliquota_iva: 22, cig: "", cup: "", stato: "da_pagare", note: "",
    procedura_id: "",
  });
  const [editLoading, setEditLoading] = useState(false);
  const [annullaConfirm, setAnnullaConfirm] = useState(false);
  const [deleteRigaId, setDeleteRigaId] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    if (!id) return;
    setLoading(true);
    const [{ data: g }, { data: p }, { data: r }, { data: d }] = await Promise.all([
      supabase.from("gal_giustificativi").select("*").eq("id", id).single(),
      supabase.from("gal_pagamenti_giust").select("*").eq("giustificativo_id", id).order("data_pagamento"),
      supabase.from("gal_righe_imputazione").select("*").eq("giustificativo_id", id).order("created_at"),
      supabase.from("gal_documenti_giustificativo").select("*").eq("giustificativo_id", id).order("tipo").order("created_at"),
    ]);
    setGiust(g as Giustificativo);
    setPagamenti((p ?? []) as PagamentoGiustificativo[]);
    setRighe((r ?? []) as RigaImputazione[]);
    setDocumenti((d ?? []) as DocumentoGiustificativo[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    if (currentGal) {
      supabase.from("gal_voci_previsione").select("*").eq("gal_id", currentGal.id).order("intervento")
        .then(({ data }) => setVociPrevisione((data ?? []) as VocePrevisione[]));
      supabase.from("gal_periodi_ses").select("*").eq("gal_id", currentGal.id).order("codice")
        .then(({ data }) => setPeriodi((data ?? []) as Periodo[]));
      supabase.from("gal_procedure").select("id, codice, oggetto, cig, cup").eq("gal_id", currentGal.id).order("codice")
        .then(({ data }) => setProcedure((data ?? []) as Procedura[]));
      supabase.from("gal_interventi").select("*").eq("gal_id", currentGal.id).order("nome")
        .then(({ data }) => setInterventi((data ?? []) as Intervento[]));
      supabase.from("gal_tipologie_spesa").select("*").eq("gal_id", currentGal.id).order("nome")
        .then(({ data }) => setAllTipologie((data ?? []) as TipologiaSpesa[]));
      supabase.from("gal_capitoli").select("*").eq("gal_id", currentGal.id).order("nome")
        .then(({ data }) => setAllCapitoli((data ?? []) as CapitoloLookup[]));
    }
  }, [id, currentGal?.id]);

  const totalePagato = pagamenti.reduce((s, p) => s + p.importo, 0);
  const proceduraLinked = giust?.procedura_id ? procedure.find((p) => p.id === giust.procedura_id) : null;

  // ── Edit giustificativo ────────────────────────────────
  function openEditModal() {
    if (!giust) return;
    setEditForm({
      numero_doc: giust.numero_doc, data_doc: giust.data_doc, tipo_doc: giust.tipo_doc,
      fornitore_denominazione: giust.fornitore_denominazione ?? "",
      fornitore_piva: giust.fornitore_piva ?? "",
      imponibile: giust.imponibile,
      aliquota_iva: giust.imponibile > 0 ? Math.round(giust.iva / giust.imponibile * 100) : 0,
      cig: giust.cig ?? "", cup: giust.cup ?? "",
      stato: giust.stato, note: giust.note ?? "",
      procedura_id: giust.procedura_id ?? "",
    });
    setShowEditModal(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !user || !currentGal) return;
    setEditLoading(true);
    const imponibile = Number(editForm.imponibile) || 0;
    const aliquota = Number(editForm.aliquota_iva) || 0;
    const iva = Math.round(imponibile * aliquota) / 100;

    // Payload completo
    const fullPayload: Record<string, unknown> = {
      numero_doc: editForm.numero_doc, data_doc: editForm.data_doc, tipo_doc: editForm.tipo_doc,
      fornitore_denominazione: editForm.fornitore_denominazione || null,
      fornitore_piva: editForm.fornitore_piva || null,
      imponibile, iva, totale: imponibile + iva,
      aliquota_iva: aliquota,
      cig: editForm.cig || null, cup: editForm.cup || null,
      stato: editForm.stato, note: editForm.note || null,
      procedura_id: editForm.procedura_id || null,
    };

    let { error } = await supabase.from("gal_giustificativi").update(fullPayload).eq("id", id);

    // Fallback: se fallisce per colonna mancante, usa solo campi minimi
    if (error?.message?.includes("schema cache")) {
      const minPayload: Record<string, unknown> = {
        numero_doc: editForm.numero_doc, data_doc: editForm.data_doc, tipo_doc: editForm.tipo_doc,
        imponibile, iva, totale: imponibile + iva, stato: editForm.stato,
      };
      ({ error } = await supabase.from("gal_giustificativi").update(minPayload).eq("id", id));
      if (!error) toast.info("Aggiornamento parziale: esegui l'SQL per aggiungere le colonne mancanti");
    }

    if (error) { toast.error(messaggioErrore(error)); setEditLoading(false); return; }
    toast.success("Documento aggiornato");
    setShowEditModal(false); setEditLoading(false); load();
  }

  async function handleAnnulla() {
    if (!id || !user || !currentGal) return;
    const { error } = await supabase.from("gal_giustificativi").update({ stato: "annullata", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "giustificativo", entitaId: id, descrizione: "Annullato" });
    toast.success("Documento annullato");
    setAnnullaConfirm(false); load();
  }

  // ── Documenti allegati ────────────────────────────────
  async function handleUploadDoc(tipo: string, file: File) {
    if (!id || !currentGal) return;
    setUploading(tipo);
    const storagePath = `giustificativi/${id}/${tipo}/${Date.now()}_${file.name}`;

    const { error: storageErr } = await supabase.storage.from("documenti_gal").upload(storagePath, file, { upsert: false });
    if (storageErr) { toast.error(messaggioErrore(storageErr, "Errore upload")); setUploading(null); return; }

    const { error: dbErr } = await supabase.from("gal_documenti_giustificativo").insert({
      gal_id: currentGal.id,
      giustificativo_id: id,
      tipo,
      nome_file: file.name,
      storage_path: storagePath,
      dimensione: file.size,
    });
    if (dbErr) { toast.error(messaggioErrore(dbErr, "Errore salvataggio")); setUploading(null); return; }
    toast.success(`${TIPO_DOC_LABELS[tipo] ?? tipo} caricato`);
    setUploading(null);
    load();
  }

  async function downloadDoc(doc: DocumentoGiustificativo) {
    const { data, error } = await supabase.storage.from("documenti_gal").createSignedUrl(doc.storage_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Errore download"); return; }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = doc.nome_file;
    a.click();
  }

  async function deleteDoc(docId: string) {
    const doc = documenti.find((d) => d.id === docId);
    if (!doc) return;
    await supabase.storage.from("documenti_gal").remove([doc.storage_path]);
    const { error } = await supabase.from("gal_documenti_giustificativo").delete().eq("id", docId);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Documento eliminato");
    setDeleteDocId(null);
    load();
  }

  async function downloadAllDocs() {
    if (documenti.length === 0) { toast.error("Nessun documento da scaricare"); return; }
    setDownloading(true);
    try {
      const zip = new JSZip();
      for (const doc of documenti) {
        const { data } = await supabase.storage.from("documenti_gal").download(doc.storage_path);
        if (data) {
          const folderName = TIPO_DOC_LABELS[doc.tipo]?.replace(/\s+/g, "_") ?? doc.tipo;
          zip.file(`${folderName}/${doc.nome_file}`, data);
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `documenti_${giust?.numero_doc?.replace(/\//g, "-") ?? id}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Download completato");
    } catch (err) {
      toast.error("Errore durante il download");
    }
    setDownloading(false);
  }

  // ── Pagamenti ──────────────────────────────────────────
  function openNewPag() {
    setEditingPagId(null);
    setPagForm({ ...EMPTY_PAG, importo: giust ? giust.totale - totalePagato : 0 });
    setShowPagModal(true);
  }
  function openEditPag(p: PagamentoGiustificativo) {
    setEditingPagId(p.id);
    setPagForm({ data_pagamento: p.data_pagamento, importo: p.importo, modalita: p.modalita ?? "bonifico", riferimento: p.riferimento ?? "", note: p.note ?? "" });
    setShowPagModal(true);
  }

  async function handleSavePag(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !currentGal) return;
    const payload = { giustificativo_id: id, gal_id: currentGal.id, data_pagamento: pagForm.data_pagamento, importo: pagForm.importo, modalita: pagForm.modalita || null, riferimento: pagForm.riferimento || null, note: pagForm.note || null };
    let error;
    if (editingPagId) {
      ({ error } = await supabase.from("gal_pagamenti_giust").update(payload).eq("id", editingPagId));
    } else {
      ({ error } = await supabase.from("gal_pagamenti_giust").insert(payload));
    }
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success(editingPagId ? "Pagamento aggiornato" : "Pagamento aggiunto");
    setShowPagModal(false); setEditingPagId(null); load();
  }

  // ── Righe imputazione ──────────────────────────────────
  function handleVoceSelect(voceId: string) {
    if (!voceId) { setRigaForm((f) => ({ ...f, voce_previsione_id: "" })); return; }
    const v = vociPrevisione.find((vp) => vp.id === voceId);
    if (v) setRigaForm((f) => ({ ...f, voce_previsione_id: v.id, intervento: v.intervento, tipologia_spesa: v.tipologia_spesa, voce: v.voce, capitolo: v.capitolo }));
  }

  function openNewRiga() {
    setEditingRigaId(null);
    setRigaForm({
      ...EMPTY_RIGA,
      imponibile_imputato: giust?.imponibile ?? 0,
      iva_imputato: giust?.iva ?? 0,
      imponibile_richiesto: null,
      iva_richiesta: null,
      totale_richiesto: null,
    });
    setShowRigaModal(true);
  }
  function openEditRiga(r: RigaImputazione) {
    setEditingRigaId(r.id);
    setRigaForm({ misura: r.misura, sotto_misura: r.sotto_misura ?? "", categoria_spesa: r.categoria_spesa, imponibile_imputato: r.imponibile_imputato, iva_imputato: r.iva_imputato, eleggibile: r.eleggibile, note: r.note ?? "", periodo_id: r.periodo_id ?? "", intervento: r.intervento ?? "", tipologia_spesa: r.tipologia_spesa ?? "", voce: r.voce ?? "", capitolo: r.capitolo ?? "", voce_previsione_id: r.voce_previsione_id ?? "", tipo_acconto: r.tipo_acconto ?? "", imponibile_richiesto: r.imponibile_richiesto, iva_richiesta: r.iva_richiesta, totale_richiesto: r.totale_richiesto });
    setShowRigaModal(true);
  }

  async function handleSaveRiga(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const payload = {
      giustificativo_id: id,
      misura: rigaForm.misura, sotto_misura: rigaForm.sotto_misura || null,
      categoria_spesa: rigaForm.categoria_spesa,
      imponibile_imputato: rigaForm.imponibile_imputato,
      iva_imputato: rigaForm.iva_imputato,
      totale_imputato: rigaForm.imponibile_imputato + rigaForm.iva_imputato,
      eleggibile: rigaForm.eleggibile, note: rigaForm.note || null,
      periodo_id: rigaForm.periodo_id || null,
      intervento: rigaForm.intervento || null, tipologia_spesa: rigaForm.tipologia_spesa || null,
      voce: rigaForm.voce || null, capitolo: rigaForm.capitolo || null,
      voce_previsione_id: rigaForm.voce_previsione_id || null,
      tipo_acconto: rigaForm.tipo_acconto || null,
      imponibile_richiesto: rigaForm.imponibile_richiesto ?? rigaForm.imponibile_imputato,
      iva_richiesta: rigaForm.iva_richiesta ?? rigaForm.iva_imputato,
      totale_richiesto: rigaForm.totale_richiesto ?? (rigaForm.imponibile_imputato + rigaForm.iva_imputato),
    };
    let error;
    if (editingRigaId) {
      ({ error } = await supabase.from("gal_righe_imputazione").update(payload).eq("id", editingRigaId));
    } else {
      ({ error } = await supabase.from("gal_righe_imputazione").insert(payload));
    }
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success(editingRigaId ? "Riga aggiornata" : "Riga aggiunta");
    setShowRigaModal(false); setEditingRigaId(null); setRigaForm({ ...EMPTY_RIGA }); load();
  }

  async function handleDeleteRiga(rigaId: string) {
    const { error } = await supabase.from("gal_righe_imputazione").delete().eq("id", rigaId);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Riga eliminata");
    setDeleteRigaId(null); load();
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Caricamento...</div>;
  if (!giust) return <div className="p-8 text-center text-red-500">Documento non trovato</div>;

  const editedAliquota = Number(editForm.aliquota_iva) || 0;
  const editedIva = Math.round(Number(editForm.imponibile) * editedAliquota) / 100;
  const docsByTipo = (tipo: string) => documenti.filter((d) => d.tipo === tipo);
  const docTypes = ["xml", "fattura_cartacea", "mandato_pagamento", "bonifico", "f24", "altro"] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate("/giustificativi")} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{giust.numero_doc}</h1>
          <p className="text-sm text-gray-500">
            {giust.tipo_doc.replace(/_/g, " ")} · {formatDate(giust.data_doc)}
            {giust.fornitore_denominazione && ` · ${giust.fornitore_denominazione}`}
          </p>
        </div>
        <span className={`badge ${STATO_COLORS[giust.stato] ?? "bg-gray-100"}`}>{giust.stato.replace(/_/g, " ")}</span>
        {write && giust.stato !== "annullata" && (
          <>
            <Link to={`/mandati/nuovo?giustificativo=${giust.id}`} className="btn-primary flex items-center gap-1"><FileText size={15} aria-hidden="true" /> Crea mandato</Link>
            <button className="btn-secondary flex items-center gap-1" onClick={openEditModal}><Edit2 size={15} /> Modifica</button>
            <button className="btn-danger flex items-center gap-1" onClick={() => setAnnullaConfirm(true)}><Ban size={15} /> Annulla</button>
          </>
        )}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card p-4"><p className="text-xs text-gray-500">Imponibile</p><p className="text-lg font-bold">{formatCurrency(giust.imponibile)}</p><p className="text-xs text-gray-400">IVA {giust.imponibile > 0 ? Math.round(giust.iva / giust.imponibile * 100) : 0}% = {formatCurrency(giust.iva)}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Totale (incl. IVA)</p><p className="text-lg font-bold">{formatCurrency(giust.totale)}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Pagato</p><p className="text-lg font-bold text-green-700">{formatCurrency(totalePagato)}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Residuo</p><p className={`text-lg font-bold ${giust.totale - totalePagato > 0 ? "text-yellow-700" : "text-green-700"}`}>{formatCurrency(giust.totale - totalePagato)}</p></div>
      </div>

      {/* Dati documento + Procedura collegata */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold mb-3">Dati Documento</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            {giust.fornitore_denominazione && <div><span className="text-gray-500">Fornitore: </span><span className="font-medium">{giust.fornitore_denominazione}</span></div>}
            {giust.fornitore_piva && <div><span className="text-gray-500">P.IVA: </span><span className="font-mono">{giust.fornitore_piva}</span></div>}
            {giust.cig && <div><span className="text-gray-500">CIG: </span><span className="font-mono">{giust.cig}</span></div>}
            {giust.cup && <div><span className="text-gray-500">CUP: </span><span className="font-mono">{giust.cup}</span></div>}
            {giust.intervento && <div><span className="text-gray-500">Intervento: </span><span className="font-medium">{giust.intervento}</span></div>}
            {giust.tipologia_spesa && <div><span className="text-gray-500">Tipologia: </span><span className="font-medium">{giust.tipologia_spesa}</span></div>}
            {giust.capitolo && <div><span className="text-gray-500">Capitolo: </span><span className="font-medium">{giust.capitolo}</span></div>}
            {giust.note && <div className="col-span-3"><span className="text-gray-500">Note: </span>{giust.note}</div>}
          </div>
        </div>

        {/* Procedura collegata */}
        <div className="card p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Link2 size={16} /> Procedura</h2>
          {proceduraLinked ? (
            <div className="space-y-2">
              <Link to={`/procedure/${proceduraLinked.id}`} className="text-blue-600 hover:underline font-medium flex items-center gap-1">
                {proceduraLinked.codice ?? "—"} <ExternalLink size={12} />
              </Link>
              <p className="text-sm text-gray-600">{proceduraLinked.oggetto}</p>
              {proceduraLinked.cig && <p className="text-xs text-gray-500">CIG: <span className="font-mono">{proceduraLinked.cig}</span></p>}
              {proceduraLinked.cup && <p className="text-xs text-gray-500">CUP: <span className="font-mono">{proceduraLinked.cup}</span></p>}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Nessuna procedura collegata. Usa "Modifica" per agganciare una procedura.</p>
          )}
        </div>
      </div>

      {/* ── Documenti Allegati ───────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Documenti Allegati</h2>
          {documenti.length > 0 && (
            <button className="btn-secondary flex items-center gap-1" onClick={downloadAllDocs} disabled={downloading}>
              <PackageOpen size={16} /> {downloading ? "Preparazione ZIP..." : "Scarica tutto (ZIP)"}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {docTypes.map((tipo) => {
            const docs = docsByTipo(tipo);
            return (
              <div key={tipo} className={`border rounded-lg overflow-hidden ${TIPO_DOC_COLORS[tipo]}`}>
                <div className="px-3 py-2 text-xs font-semibold border-b flex items-center justify-between">
                  <span>{TIPO_DOC_LABELS[tipo]}</span>
                  <span className="badge bg-white/50 text-xs">{docs.length}</span>
                </div>
                <div className="bg-white divide-y">
                  {docs.map((doc) => (
                    <div key={doc.id} className="px-3 py-2 flex items-center justify-between text-sm group">
                      <button className="text-blue-600 hover:underline truncate text-left flex-1" onClick={() => downloadDoc(doc)}>
                        <FileText size={12} className="inline mr-1" />{doc.nome_file}
                      </button>
                      <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100">
                        <button className="p-1 text-blue-400 hover:text-blue-600" onClick={() => downloadDoc(doc)}><Download size={13} /></button>
                        {write && <button className="p-1 text-red-400 hover:text-red-600" onClick={() => setDeleteDocId(doc.id)}><Trash2 size={13} /></button>}
                      </div>
                    </div>
                  ))}
                  {docs.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nessun file</p>}
                </div>
                {write && (
                  <div className="border-t bg-gray-50 px-3 py-1.5">
                    <input
                      ref={(el) => { fileInputRefs.current[tipo] = el; }}
                      type="file"
                      className="hidden"
                      accept={tipo === "xml" ? ".xml,.p7m" : ".pdf,.jpg,.jpeg,.png,.tif,.tiff,.doc,.docx"}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadDoc(tipo, f);
                        e.target.value = "";
                      }}
                    />
                    <button
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 w-full justify-center py-1"
                      onClick={() => fileInputRefs.current[tipo]?.click()}
                      disabled={uploading === tipo}
                    >
                      <Upload size={12} /> {uploading === tipo ? "Caricamento..." : "Carica file"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pagamenti */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Pagamenti</h2>
          {write && <button className="btn-primary" onClick={openNewPag}><Plus size={16} /> Aggiungi pagamento</button>}
        </div>
        <div className="card divide-y divide-gray-100">
          {pagamenti.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">Nessun pagamento registrato</p>}
          {pagamenti.map((p) => (
            <div key={p.id} className="p-4 flex items-center justify-between group">
              <div>
                <p className="font-medium">{formatCurrency(p.importo)}</p>
                <p className="text-xs text-gray-500">
                  {formatDate(p.data_pagamento)} · {p.modalita ?? "-"}
                  {p.riferimento ? ` · Rif: ${p.riferimento}` : ""}
                </p>
              </div>
              {write && <button className="opacity-0 group-hover:opacity-100 text-blue-400 hover:text-blue-600 p-1" onClick={() => openEditPag(p)}><Edit2 size={15} /></button>}
            </div>
          ))}
        </div>
      </div>

      {/* Righe imputazione */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Imputazione</h2>
          {write && <button className="btn-secondary" onClick={openNewRiga}><Plus size={16} /> Aggiungi riga</button>}
        </div>
        <div className="card divide-y divide-gray-100">
          {righe.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">Nessuna imputazione. Aggiungi una riga per collegare questa spesa alla rendicontazione SES.</p>}
          {righe.map((r) => (
            <div key={r.id} className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge bg-blue-100 text-blue-700">{r.misura}{r.sotto_misura ? ` / ${r.sotto_misura}` : ""}</span>
                  <span className="badge bg-gray-100 text-gray-600">{r.categoria_spesa.replace(/_/g, " ")}</span>
                  {r.tipo_acconto && <span className="badge bg-cyan-100 text-cyan-700">{TIPO_ACCONTO_LABELS[r.tipo_acconto] ?? r.tipo_acconto}</span>}
                  {r.periodo_id && <span className="badge bg-yellow-50 text-yellow-700 border border-yellow-200">SES: {periodi.find(p => p.id === r.periodo_id)?.codice ?? "?"}</span>}
                  {!r.eleggibile && <span className="badge bg-red-100 text-red-600">Non eleggibile</span>}
                </div>
                {(r.intervento || r.capitolo) && (
                  <div className="flex flex-wrap gap-2 text-xs mt-1">
                    {r.intervento && <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">Interv: {r.intervento}</span>}
                    {r.capitolo && <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded border border-teal-200">Cap: {r.capitolo}</span>}
                  </div>
                )}
                <p className="text-sm text-gray-700">
                  Imponibile: <strong>{formatCurrency(r.imponibile_imputato)}</strong>{" · "}
                  IVA: <span className="text-orange-600">{formatCurrency(r.iva_imputato)}</span>{" · "}
                  Tot: <strong>{formatCurrency(r.totale_imputato)}</strong>
                </p>
                {r.totale_richiesto != null && r.totale_richiesto !== r.totale_imputato && (
                  <p className="text-xs text-indigo-600">
                    Richiesto a rimborso: <strong>{formatCurrency(r.imponibile_richiesto ?? r.imponibile_imputato)}</strong>
                    {" + IVA "}{formatCurrency(r.iva_richiesta ?? r.iva_imputato)}
                    {" = "}<strong>{formatCurrency(r.totale_richiesto)}</strong>
                  </p>
                )}
              </div>
              {write && (
                <div className="flex gap-1 flex-shrink-0">
                  <button className="text-blue-400 hover:text-blue-600 p-1" onClick={() => openEditRiga(r)}><Edit2 size={15} /></button>
                  <button className="text-red-400 hover:text-red-600 p-1" onClick={() => setDeleteRigaId(r.id)}><Trash2 size={15} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Modal pagamento */}
      <Modal open={showPagModal} onClose={() => { setShowPagModal(false); setEditingPagId(null); }} title={editingPagId ? "Modifica Pagamento" : "Aggiungi Pagamento"}>
        <form onSubmit={handleSavePag} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Data *</label><input className="input" type="date" required value={pagForm.data_pagamento} onChange={(e) => setPagForm({ ...pagForm, data_pagamento: e.target.value })} /></div>
            <div><label className="label">Importo (€) *</label><input className="input" type="number" step="0.01" required value={pagForm.importo} onChange={(e) => setPagForm({ ...pagForm, importo: parseFloat(e.target.value) || 0 })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Modalità</label>
              <select className="input" value={pagForm.modalita} onChange={(e) => setPagForm({ ...pagForm, modalita: e.target.value })}>
                <option value="bonifico">Bonifico</option><option value="f24">F24</option>
                <option value="contante">Contante</option><option value="altro">Altro</option>
              </select></div>
            <div><label className="label">Riferimento (n. mandato / CRO)</label><input className="input" value={pagForm.riferimento} onChange={(e) => setPagForm({ ...pagForm, riferimento: e.target.value })} /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1">{editingPagId ? "Salva modifiche" : "Salva pagamento"}</button>
            <button type="button" className="btn-secondary" onClick={() => { setShowPagModal(false); setEditingPagId(null); }}>Annulla</button>
          </div>
        </form>
      </Modal>

      {/* Modal riga imputazione */}
      <Modal open={showRigaModal} onClose={() => { setShowRigaModal(false); setEditingRigaId(null); }} title={editingRigaId ? "Modifica Riga Imputazione" : "Aggiungi Riga Imputazione"} size="lg">
        <form onSubmit={handleSaveRiga} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label font-semibold text-primary-700">Tipologia rata *</label>
              <select className="input" required value={rigaForm.tipo_acconto} onChange={(e) => setRigaForm({ ...rigaForm, tipo_acconto: e.target.value })}>
                <option value="">— Seleziona rata —</option>
                <option value="i_acconto">I Acconto</option>
                <option value="ii_acconto">II Acconto</option>
                <option value="saldo">Saldo</option>
              </select></div>
            <div><label className="label font-semibold text-primary-700">Periodo SES</label>
              <select className="input" value={rigaForm.periodo_id} onChange={(e) => setRigaForm({ ...rigaForm, periodo_id: e.target.value })}>
                <option value="">— Nessun periodo —</option>
                {periodi.map((p) => <option key={p.id} value={p.id}>{p.codice} — {p.descrizione}</option>)}
              </select>
              {!rigaForm.periodo_id && <p className="text-xs text-orange-600 mt-1">Senza periodo questa spesa non apparirà nel Report SES.</p>}
            </div>
          </div>

          {/* Imputazione da previsione con dropdown a cascata */}
          <div className="border rounded-lg p-3 bg-blue-50/50 space-y-3">
            <p className="text-xs font-semibold text-blue-700 uppercase">Imputazione da previsione</p>
            {vociPrevisione.length > 0 && (
              <div><label className="label text-xs">Voce di previsione (auto-compila tutti i campi)</label>
                <select className="input text-sm" value={rigaForm.voce_previsione_id} onChange={(e) => handleVoceSelect(e.target.value)}>
                  <option value="">— oppure scegli dai menu sotto —</option>
                  {vociPrevisione.map((v) => <option key={v.id} value={v.id}>{v.intervento} · {v.tipologia_spesa} · {v.voce} · Cap. {v.capitolo}</option>)}
                </select></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label text-xs">Intervento</label>
                <select className="input text-sm" value={rigaForm.intervento} onChange={(e) => {
                  setRigaForm({ ...rigaForm, intervento: e.target.value, tipologia_spesa: "", capitolo: "", voce_previsione_id: "" });
                }}>
                  <option value="">— Seleziona —</option>
                  {interventi.map((i) => <option key={i.id} value={i.nome}>{i.nome}</option>)}
                </select></div>
              <div><label className="label text-xs">Tipologia Spesa</label>
                <select className="input text-sm" value={rigaForm.tipologia_spesa} onChange={(e) => {
                  setRigaForm({ ...rigaForm, tipologia_spesa: e.target.value, capitolo: "", voce_previsione_id: "" });
                }} disabled={!rigaForm.intervento}>
                  <option value="">— Seleziona —</option>
                  {allTipologie
                    .filter((t) => {
                      const int = interventi.find((i) => i.nome === rigaForm.intervento);
                      return int ? t.intervento_id === int.id : true;
                    })
                    .map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
                </select></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label text-xs">Capitolo</label>
                <select className="input text-sm" value={rigaForm.capitolo} onChange={(e) => {
                  setRigaForm({ ...rigaForm, capitolo: e.target.value, voce_previsione_id: "" });
                }} disabled={!rigaForm.tipologia_spesa}>
                  <option value="">— Seleziona —</option>
                  {allCapitoli
                    .filter((c) => {
                      const tip = allTipologie.find((t) => t.nome === rigaForm.tipologia_spesa);
                      return tip ? c.tipologia_id === tip.id : true;
                    })
                    .map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select></div>
              <div><label className="label text-xs">Voce (opzionale)</label>
                <input className="input text-sm" value={rigaForm.voce} onChange={(e) => setRigaForm({ ...rigaForm, voce: e.target.value })} placeholder="Descrizione voce" /></div>
            </div>
          </div>

          <hr className="border-gray-200" />
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Misura *</label>
              <select className="input" required value={`${rigaForm.misura}${rigaForm.sotto_misura ? "." + rigaForm.sotto_misura : ""}`} onChange={(e) => {
                const val = e.target.value;
                const parts = val.split(".");
                const misura = parts.length > 1 ? parts.slice(0, -1).join(".") : val;
                const sotto = parts.length > 1 ? parts[parts.length - 1] : "";
                setRigaForm({ ...rigaForm, misura, sotto_misura: sotto });
              }}>
                <option value="">— Seleziona misura —</option>
                {(() => {
                  const codes = new Set<string>();
                  periodi.forEach((p) => { if (p.misura) codes.add(p.sotto_misura ? `${p.misura}.${p.sotto_misura}` : p.misura); });
                  return [...codes].sort().map((c) => <option key={c} value={c}>{c}</option>);
                })()}
              </select></div>
            <div><label className="label">Categoria *</label>
              <select className="input" required value={rigaForm.categoria_spesa} onChange={(e) => setRigaForm({ ...rigaForm, categoria_spesa: e.target.value })}>
                <option value="spese_personale">Spese personale</option>
                <option value="costi_funzionamento">Costi funzionamento</option>
                <option value="spese_animazione">Spese animazione</option>
                <option value="spese_formazione">Spese formazione</option>
                <option value="spese_comunicazione">Spese comunicazione</option>
                <option value="altro">Altro</option>
              </select></div>
          </div>

          {/* Importi spesa */}
          <div className="border rounded-lg p-3 bg-gray-50 space-y-3">
            <p className="text-xs font-semibold text-gray-600 uppercase">Importi spesa sostenuta</p>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="label text-xs">Imponibile (€) *</label><input className="input" type="number" step="0.01" required value={rigaForm.imponibile_imputato} onChange={(e) => setRigaForm({ ...rigaForm, imponibile_imputato: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className="label text-xs">IVA (€)</label><input className="input" type="number" step="0.01" value={rigaForm.iva_imputato} onChange={(e) => setRigaForm({ ...rigaForm, iva_imputato: parseFloat(e.target.value) || 0 })} /></div>
              <div><label className="label text-xs">Totale</label><input className="input bg-white" readOnly value={formatCurrency(rigaForm.imponibile_imputato + rigaForm.iva_imputato)} /></div>
            </div>
          </div>

          {/* Importi richiesti a rimborso */}
          <div className="border rounded-lg p-3 bg-indigo-50/50 space-y-3">
            <p className="text-xs font-semibold text-indigo-700 uppercase">Importi richiesti a rimborso</p>
            <p className="text-xs text-indigo-500">Se non compilati, la spesa viene richiesta integralmente a rimborso</p>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="label text-xs">Imponibile richiesto (€)</label>
                <input className="input" type="number" step="0.01"
                  placeholder={String(rigaForm.imponibile_imputato)}
                  value={rigaForm.imponibile_richiesto ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? null : parseFloat(e.target.value) || 0;
                    const ivaRich = rigaForm.iva_richiesta;
                    setRigaForm({ ...rigaForm, imponibile_richiesto: val, totale_richiesto: val !== null || ivaRich !== null ? (val ?? rigaForm.imponibile_imputato) + (ivaRich ?? rigaForm.iva_imputato) : null });
                  }} /></div>
              <div><label className="label text-xs">IVA richiesta (€)</label>
                <input className="input" type="number" step="0.01"
                  placeholder={String(rigaForm.iva_imputato)}
                  value={rigaForm.iva_richiesta ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? null : parseFloat(e.target.value) || 0;
                    const impRich = rigaForm.imponibile_richiesto;
                    setRigaForm({ ...rigaForm, iva_richiesta: val, totale_richiesto: val !== null || impRich !== null ? (impRich ?? rigaForm.imponibile_imputato) + (val ?? rigaForm.iva_imputato) : null });
                  }} /></div>
              <div><label className="label text-xs">Totale richiesto</label>
                <input className="input bg-white" readOnly value={formatCurrency(rigaForm.totale_richiesto ?? (rigaForm.imponibile_imputato + rigaForm.iva_imputato))} /></div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="eleggibile" checked={rigaForm.eleggibile} onChange={(e) => setRigaForm({ ...rigaForm, eleggibile: e.target.checked })} />
            <label htmlFor="eleggibile" className="text-sm">Spesa eleggibile</label>
          </div>
          <div><label className="label">Note</label><textarea className="input text-sm" rows={2} value={rigaForm.note} onChange={(e) => setRigaForm({ ...rigaForm, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1">{editingRigaId ? "Aggiorna riga" : "Salva riga"}</button>
            <button type="button" className="btn-secondary" onClick={() => { setShowRigaModal(false); setEditingRigaId(null); }}>Chiudi</button>
          </div>
        </form>
      </Modal>

      {/* Modal modifica giustificativo */}
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Modifica Documento" size="lg">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Numero documento *</label><input className="input" required value={editForm.numero_doc} onChange={(e) => setEditForm({ ...editForm, numero_doc: e.target.value })} /></div>
            <div><label className="label">Data *</label><input className="input" type="date" required value={editForm.data_doc} onChange={(e) => setEditForm({ ...editForm, data_doc: e.target.value })} /></div>
          </div>
          <div><label className="label">Tipo documento</label>
            <select className="input" value={editForm.tipo_doc} onChange={(e) => setEditForm({ ...editForm, tipo_doc: e.target.value })}>
              <option value="fattura">Fattura</option><option value="fattura_elettronica">Fattura elettronica</option>
              <option value="nota_credito">Nota di credito</option><option value="ricevuta">Ricevuta</option>
              <option value="busta_paga">Busta paga</option><option value="f24">F24</option><option value="altro">Altro</option>
            </select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Fornitore</label><input className="input" value={editForm.fornitore_denominazione} onChange={(e) => setEditForm({ ...editForm, fornitore_denominazione: e.target.value })} /></div>
            <div><label className="label">P.IVA fornitore</label><input className="input font-mono" value={editForm.fornitore_piva} onChange={(e) => setEditForm({ ...editForm, fornitore_piva: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Imponibile (€) *</label><input className="input" type="number" step="0.01" required value={editForm.imponibile} onChange={(e) => setEditForm({ ...editForm, imponibile: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Aliquota IVA (%)</label><input className="input" type="number" step="0.01" min="0" max="100" value={editForm.aliquota_iva} onChange={(e) => setEditForm({ ...editForm, aliquota_iva: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Totale (calcolato)</label><input className="input bg-gray-50 text-gray-600" readOnly value={(Number(editForm.imponibile) + editedIva).toFixed(2)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">CIG</label><input className="input font-mono" value={editForm.cig} onChange={(e) => setEditForm({ ...editForm, cig: e.target.value })} /></div>
            <div><label className="label">CUP</label><input className="input font-mono" value={editForm.cup} onChange={(e) => setEditForm({ ...editForm, cup: e.target.value })} /></div>
          </div>
          {/* Procedura collegata */}
          <div className="border-t pt-4">
            <label className="label font-semibold">Procedura collegata</label>
            <select className="input" value={editForm.procedura_id} onChange={(e) => setEditForm({ ...editForm, procedura_id: e.target.value })}>
              <option value="">— Nessuna procedura —</option>
              {procedure.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codice ?? "—"} · {p.oggetto}{p.cig ? ` (CIG: ${p.cig})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div><label className="label">Stato</label>
            <select className="input" value={editForm.stato} onChange={(e) => setEditForm({ ...editForm, stato: e.target.value })}>
              <option value="da_pagare">Da pagare</option><option value="parzialmente_pagata">Parzialmente pagata</option>
              <option value="pagata">Pagata</option><option value="annullata">Annullata</option>
            </select></div>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={editLoading} className="btn-primary flex-1">{editLoading ? "Salvataggio..." : "Salva modifiche"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={annullaConfirm} title="Annulla documento" message={`Annullare il documento ${giust.numero_doc}?`} confirmLabel="Annulla documento" danger onConfirm={handleAnnulla} onCancel={() => setAnnullaConfirm(false)} />
      <ConfirmDialog open={!!deleteRigaId} title="Elimina riga" message="Eliminare questa riga di imputazione?" confirmLabel="Elimina" danger onConfirm={() => deleteRigaId && handleDeleteRiga(deleteRigaId)} onCancel={() => setDeleteRigaId(null)} />
      <ConfirmDialog open={!!deleteDocId} title="Elimina documento" message="Eliminare questo file allegato?" confirmLabel="Elimina" danger onConfirm={() => deleteDocId && deleteDoc(deleteDocId)} onCancel={() => setDeleteDocId(null)} />
    </div>
  );
}
