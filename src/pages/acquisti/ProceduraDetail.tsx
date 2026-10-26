// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Plus, Check, AlertCircle, Pencil, Trash2, FileText, PackageOpen, ExternalLink } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import JSZip from "jszip";
import type { Procedura, ProceduraInvitato, StatoProcedura, Giustificativo, DocumentoGiustificativo } from "../../types";

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

const INVITATO_FORM_INIT = {
  denominazione: "", partita_iva: "", offerta_presentata: false, importo_offerta: 0, note: "",
};

export default function ProceduraDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  const [procedura, setProcedura] = useState<Procedura | null>(null);
  const [invitati, setInvitati] = useState<ProceduraInvitato[]>([]);
  const [giustificativi, setGiustificativi] = useState<Giustificativo[]>([]);
  const [documentiMap, setDocumentiMap] = useState<Record<string, DocumentoGiustificativo[]>>({});
  const [loading, setLoading] = useState(true);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Procedura>>({});
  const [saving, setSaving] = useState(false);

  const [showInvitatoModal, setShowInvitatoModal] = useState(false);
  const [editInvitato, setEditInvitato] = useState<ProceduraInvitato | null>(null);
  const [invitatoForm, setInvitatoForm] = useState(INVITATO_FORM_INIT);
  const [deleteInvitato, setDeleteInvitato] = useState<ProceduraInvitato | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const [{ data: proc }, { data: inv }] = await Promise.all([
      supabase.from("gal_procedure").select("*").eq("id", id).single(),
      supabase.from("gal_procedure_invitati").select("*").eq("procedura_id", id).order("denominazione"),
    ]);
    setProcedura(proc as Procedura | null);
    setInvitati((inv ?? []) as ProceduraInvitato[]);

    // Carica giustificativi collegati a questa procedura
    const { data: giustData } = await supabase.from("gal_giustificativi").select("*").eq("procedura_id", id).order("data_doc");
    const giustList = (giustData ?? []) as Giustificativo[];
    setGiustificativi(giustList);

    // Carica documenti per ogni giustificativo
    if (giustList.length > 0) {
      const giustIds = giustList.map((g) => g.id);
      const { data: docsData } = await supabase.from("gal_documenti_giustificativo").select("*").in("giustificativo_id", giustIds).order("tipo");
      const map: Record<string, DocumentoGiustificativo[]> = {};
      for (const d of (docsData ?? []) as DocumentoGiustificativo[]) {
        if (!map[d.giustificativo_id]) map[d.giustificativo_id] = [];
        map[d.giustificativo_id].push(d);
      }
      setDocumentiMap(map);
    } else {
      setDocumentiMap({});
    }

    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  function openEdit() {
    if (!procedura) return;
    setEditForm({ ...procedura });
    setShowEditModal(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!procedura || !user || !currentGal) return;
    setSaving(true);
    const { error } = await supabase.from("gal_procedure").update({
      oggetto: editForm.oggetto,
      tipo_procedura: editForm.tipo_procedura,
      importo_stimato: editForm.importo_stimato,
      importo_aggiudicato: editForm.importo_aggiudicato ?? null,
      cig: editForm.cig || null,
      cup: editForm.cup || null,
      rup_nome: editForm.rup_nome || null,
      rup_email: editForm.rup_email || null,
      fornitore_aggiudicatario: editForm.fornitore_aggiudicatario || null,
      stato: editForm.stato,
      pubblicato_anac: editForm.pubblicato_anac ?? false,
      data_determina: editForm.data_determina || null,
      data_affidamento: editForm.data_affidamento || null,
      data_contratto: editForm.data_contratto || null,
      note: editForm.note || null,
    }).eq("id", procedura.id);
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "procedura", descrizione: procedura.oggetto });
    toast.success("Procedura aggiornata");
    setShowEditModal(false); setSaving(false); load();
  }

  async function handleDelete() {
    if (!procedura || !user || !currentGal) return;
    const { error } = await supabase.from("gal_procedure").delete().eq("id", procedura.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Procedura eliminata");
    navigate("/procedure");
  }

  function openAddInvitato() {
    setEditInvitato(null);
    setInvitatoForm(INVITATO_FORM_INIT);
    setShowInvitatoModal(true);
  }

  function openEditInvitato(inv: ProceduraInvitato) {
    setEditInvitato(inv);
    setInvitatoForm({
      denominazione: inv.denominazione,
      partita_iva: inv.partita_iva ?? "",
      offerta_presentata: inv.offerta_presentata,
      importo_offerta: inv.importo_offerta ?? 0,
      note: inv.note ?? "",
    });
    setShowInvitatoModal(true);
  }

  async function handleSaveInvitato(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !currentGal || !user) return;
    setSaving(true);
    const payload = {
      procedura_id: id,
      gal_id: currentGal.id,
      denominazione: invitatoForm.denominazione,
      partita_iva: invitatoForm.partita_iva || null,
      offerta_presentata: invitatoForm.offerta_presentata,
      importo_offerta: invitatoForm.offerta_presentata ? invitatoForm.importo_offerta : null,
      note: invitatoForm.note || null,
    };
    let error;
    if (editInvitato) {
      ({ error } = await supabase.from("gal_procedure_invitati").update(payload).eq("id", editInvitato.id));
    } else {
      ({ error } = await supabase.from("gal_procedure_invitati").insert(payload));
    }
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    toast.success(editInvitato ? "Invitato aggiornato" : "Invitato aggiunto");
    setShowInvitatoModal(false); setSaving(false); setEditInvitato(null); load();
  }

  async function handleDeleteInvitato(inv: ProceduraInvitato) {
    const { error } = await supabase.from("gal_procedure_invitati").delete().eq("id", inv.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Invitato eliminato");
    setDeleteInvitato(null); load();
  }

  if (loading) return <p className="p-8 text-center text-gray-400">Caricamento...</p>;
  if (!procedura) return <p className="p-8 text-center text-red-500">Procedura non trovata</p>;

  const statoIdx = STATI_PROCEDURA.indexOf(procedura.stato);
  const offerteRicevute = invitati.filter((i) => i.offerta_presentata);
  const minOfferta = offerteRicevute.length > 0 ? Math.min(...offerteRicevute.map((i) => i.importo_offerta ?? Infinity)) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <button className="btn-ghost p-1 mt-0.5" onClick={() => navigate("/procedure")}><ArrowLeft size={20} /></button>
          <div>
            <h1 className="text-xl font-bold">{procedura.oggetto}</h1>
            <div className="flex items-center gap-2 mt-1">
              {procedura.codice && <span className="font-mono text-xs text-gray-500">{procedura.codice}</span>}
              <span className={`badge ${STATO_COLORS[procedura.stato]}`}>{procedura.stato.replace(/_/g, " ")}</span>
              {!procedura.cig && procedura.stato !== "fabbisogno" && (
                <span className="badge bg-red-100 text-red-600 flex items-center gap-1"><AlertCircle size={10} /> CIG mancante</span>
              )}
              {procedura.pubblicato_anac && (
                <span className="badge bg-green-100 text-green-700 flex items-center gap-1"><Check size={10} /> ANAC</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {write && <button className="btn-secondary" onClick={openEdit}><Pencil size={16} /> Modifica</button>}
          {admin && <button className="btn-ghost text-red-500" onClick={() => setDeleteConfirm(true)}><Trash2 size={16} /></button>}
        </div>
      </div>

      {/* Progress steps */}
      <div className="card p-4">
        <div className="flex items-center gap-0">
          {STATI_PROCEDURA.map((s, i) => (
            <div key={s} className="flex items-center flex-1 min-w-0">
              <div className={`flex flex-col items-center min-w-0 ${i <= statoIdx ? "text-green-700" : "text-gray-300"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < statoIdx ? "bg-green-600 text-white" : i === statoIdx ? "bg-green-700 text-white ring-2 ring-green-300" : "bg-gray-200 text-gray-400"}`}>
                  {i < statoIdx ? <Check size={12} /> : i + 1}
                </div>
                <span className="text-xs mt-1 text-center leading-tight hidden sm:block" style={{ fontSize: "0.6rem" }}>{s.replace(/_/g, " ")}</span>
              </div>
              {i < STATI_PROCEDURA.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${i < statoIdx ? "bg-green-400" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Dati principali */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4 space-y-3">
          <h2 className="font-semibold text-gray-700 border-b pb-1">Dati procedura</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">Tipo</dt><dd>{procedura.tipo_procedura?.replace(/_/g, " ") ?? "-"}</dd>
            <dt className="text-gray-500">Importo stimato</dt><dd className="font-semibold">{formatCurrency(procedura.importo_stimato)}</dd>
            <dt className="text-gray-500">Importo aggiudicato</dt><dd className="font-semibold text-green-700">{procedura.importo_aggiudicato != null ? formatCurrency(procedura.importo_aggiudicato) : "-"}</dd>
            <dt className="text-gray-500">CIG</dt><dd className="font-mono text-xs">{procedura.cig ?? "-"}</dd>
            <dt className="text-gray-500">CUP</dt><dd className="font-mono text-xs">{procedura.cup ?? "-"}</dd>
            <dt className="text-gray-500">Aggiudicatario</dt><dd>{procedura.fornitore_aggiudicatario ?? "-"}</dd>
          </dl>
        </div>
        <div className="card p-4 space-y-3">
          <h2 className="font-semibold text-gray-700 border-b pb-1">Date e RUP</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">Data determina</dt><dd>{procedura.data_determina ? formatDate(procedura.data_determina) : "-"}</dd>
            <dt className="text-gray-500">Data affidamento</dt><dd>{procedura.data_affidamento ? formatDate(procedura.data_affidamento) : "-"}</dd>
            <dt className="text-gray-500">Data contratto</dt><dd>{procedura.data_contratto ? formatDate(procedura.data_contratto) : "-"}</dd>
            <dt className="text-gray-500">RUP</dt><dd>{procedura.rup_nome ?? "-"}</dd>
            <dt className="text-gray-500">Email RUP</dt><dd className="text-xs">{procedura.rup_email ?? "-"}</dd>
            <dt className="text-gray-500">Pubblicato ANAC</dt><dd>{procedura.pubblicato_anac ? <span className="text-green-600">Sì</span> : <span className="text-gray-400">No</span>}</dd>
          </dl>
        </div>
      </div>

      {procedura.note && (
        <div className="card p-4">
          <p className="text-sm text-gray-500 mb-1">Note</p>
          <p className="text-sm whitespace-pre-line">{procedura.note}</p>
        </div>
      )}

      {/* Invitati / Offerte */}
      <div className="card">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold">Operatori invitati / Offerte</h2>
            <p className="text-xs text-gray-500">{invitati.length} invitati · {offerteRicevute.length} offerte ricevute{minOfferta !== null ? ` · min ${formatCurrency(minOfferta)}` : ""}</p>
          </div>
          {write && (
            <button className="btn-primary text-sm" onClick={openAddInvitato}><Plus size={14} /> Aggiungi</button>
          )}
        </div>
        {invitati.length === 0 ? (
          <p className="p-6 text-center text-gray-400 text-sm">Nessun operatore registrato</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left">Denominazione</th>
                  <th className="px-4 py-2 text-left">P.IVA</th>
                  <th className="px-4 py-2 text-center">Offerta</th>
                  <th className="px-4 py-2 text-right">Importo offerta</th>
                  {write && <th className="px-4 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {invitati.map((inv) => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{inv.denominazione}</td>
                    <td className="px-4 py-2 font-mono text-xs">{inv.partita_iva ?? "-"}</td>
                    <td className="px-4 py-2 text-center">
                      {inv.offerta_presentata
                        ? <span className="text-green-600"><Check size={14} /></span>
                        : <span className="text-gray-300">–</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {inv.importo_offerta != null ? (
                        <span className={inv.importo_offerta === minOfferta && minOfferta !== null ? "text-green-700 font-bold" : ""}>
                          {formatCurrency(inv.importo_offerta)}
                        </span>
                      ) : "-"}
                    </td>
                    {write && (
                      <td className="px-4 py-2">
                        <div className="flex gap-1 justify-end">
                          <button className="btn-ghost p-1 text-xs" onClick={() => openEditInvitato(inv)}>Modifica</button>
                          <button className="btn-ghost p-1 text-xs text-red-500" onClick={() => setDeleteInvitato(inv)}><Trash2 size={12} /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Giustificativi collegati ───────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="font-semibold">Giustificativi collegati</h2>
            <p className="text-xs text-gray-500">
              {giustificativi.length} documenti · Totale: {formatCurrency(giustificativi.reduce((s, g) => s + g.totale, 0))}
            </p>
          </div>
          {giustificativi.length > 0 && (
            <button className="btn-secondary flex items-center gap-1" disabled={downloadingZip} onClick={async () => {
              setDownloadingZip(true);
              try {
                const zip = new JSZip();
                // Documenti procedura (allegati propri della procedura - potenziali futuri)
                // Documenti giustificativi
                for (const g of giustificativi) {
                  const docs = documentiMap[g.id] ?? [];
                  const folderName = `${g.numero_doc.replace(/[/\\]/g, "-")}_${g.fornitore_denominazione?.replace(/[/\\]/g, "-") ?? ""}`;
                  for (const doc of docs) {
                    const { data } = await supabase.storage.from("documenti_gal").download(doc.storage_path);
                    if (data) zip.file(`${folderName}/${doc.nome_file}`, data);
                  }
                }
                const blob = await zip.generateAsync({ type: "blob" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `procedura_${procedura.codice?.replace(/[/\\]/g, "-") ?? procedura.id}_documenti.zip`;
                a.click();
                URL.revokeObjectURL(a.href);
                toast.success("Download completato");
              } catch { toast.error("Errore download"); }
              setDownloadingZip(false);
            }}>
              <PackageOpen size={16} /> {downloadingZip ? "Preparazione..." : "Scarica documentazione (ZIP)"}
            </button>
          )}
        </div>
        {giustificativi.length === 0 ? (
          <p className="p-6 text-center text-gray-400 text-sm">Nessun giustificativo collegato. Puoi agganciare un giustificativo dalla sua scheda dettaglio.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left">N. Documento</th>
                  <th className="px-4 py-2 text-left">Data</th>
                  <th className="px-4 py-2 text-left">Fornitore</th>
                  <th className="px-4 py-2 text-right">Imponibile</th>
                  <th className="px-4 py-2 text-right">Totale</th>
                  <th className="px-4 py-2 text-center">Stato</th>
                  <th className="px-4 py-2 text-center">Documenti</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {giustificativi.map((g) => {
                  const docs = documentiMap[g.id] ?? [];
                  return (
                    <tr key={g.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{g.numero_doc}</td>
                      <td className="px-4 py-2">{formatDate(g.data_doc)}</td>
                      <td className="px-4 py-2">{g.fornitore_denominazione ?? "—"}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(g.imponibile)}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatCurrency(g.totale)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`badge text-xs ${g.stato === "pagata" ? "bg-green-100 text-green-700" : g.stato === "da_pagare" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>
                          {g.stato.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex gap-1 justify-center flex-wrap">
                          {docs.length > 0 ? docs.map((d) => (
                            <button key={d.id} className="text-blue-500 hover:text-blue-700" title={d.nome_file} onClick={async () => {
                              const { data } = await supabase.storage.from("documenti_gal").createSignedUrl(d.storage_path, 3600);
                              if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                            }}>
                              <FileText size={14} />
                            </button>
                          )) : <span className="text-gray-300 text-xs">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <Link to={`/giustificativi/${g.id}`} className="text-blue-500 hover:text-blue-700">
                          <ExternalLink size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right">Totale:</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(giustificativi.reduce((s, g) => s + g.imponibile, 0))}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(giustificativi.reduce((s, g) => s + g.totale, 0))}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Modifica Procedura" size="lg">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div>
            <label className="label">Oggetto *</label>
            <input className="input" required value={editForm.oggetto ?? ""} onChange={(e) => setEditForm({ ...editForm, oggetto: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Tipo procedura</label>
              <select className="input" value={editForm.tipo_procedura ?? ""} onChange={(e) => setEditForm({ ...editForm, tipo_procedura: e.target.value })}>
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
            <div><label className="label">Stato</label>
              <select className="input" value={editForm.stato ?? "fabbisogno"} onChange={(e) => setEditForm({ ...editForm, stato: e.target.value as StatoProcedura })}>
                {STATI_PROCEDURA.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Importo stimato (€)</label>
              <input className="input" type="number" step="0.01" value={editForm.importo_stimato ?? 0}
                onChange={(e) => setEditForm({ ...editForm, importo_stimato: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Importo aggiudicato (€)</label>
              <input className="input" type="number" step="0.01" value={editForm.importo_aggiudicato ?? ""}
                onChange={(e) => setEditForm({ ...editForm, importo_aggiudicato: parseFloat(e.target.value) || null })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">CIG</label><input className="input font-mono" value={editForm.cig ?? ""} onChange={(e) => setEditForm({ ...editForm, cig: e.target.value })} /></div>
            <div><label className="label">CUP</label><input className="input font-mono" value={editForm.cup ?? ""} onChange={(e) => setEditForm({ ...editForm, cup: e.target.value })} /></div>
          </div>
          <div><label className="label">Fornitore aggiudicatario</label>
            <input className="input" value={editForm.fornitore_aggiudicatario ?? ""} onChange={(e) => setEditForm({ ...editForm, fornitore_aggiudicatario: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Data determina</label><input className="input" type="date" value={editForm.data_determina ?? ""} onChange={(e) => setEditForm({ ...editForm, data_determina: e.target.value })} /></div>
            <div><label className="label">Data affidamento</label><input className="input" type="date" value={editForm.data_affidamento ?? ""} onChange={(e) => setEditForm({ ...editForm, data_affidamento: e.target.value })} /></div>
            <div><label className="label">Data contratto</label><input className="input" type="date" value={editForm.data_contratto ?? ""} onChange={(e) => setEditForm({ ...editForm, data_contratto: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">RUP - Nome</label><input className="input" value={editForm.rup_nome ?? ""} onChange={(e) => setEditForm({ ...editForm, rup_nome: e.target.value })} /></div>
            <div><label className="label">RUP - Email</label><input className="input" type="email" value={editForm.rup_email ?? ""} onChange={(e) => setEditForm({ ...editForm, rup_email: e.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={editForm.pubblicato_anac ?? false} onChange={(e) => setEditForm({ ...editForm, pubblicato_anac: e.target.checked })} />
            Pubblicato su ANAC
          </label>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={editForm.note ?? ""} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      {/* Invitato modal */}
      <Modal open={showInvitatoModal} onClose={() => setShowInvitatoModal(false)} title={editInvitato ? "Modifica invitato" : "Aggiungi invitato"}>
        <form onSubmit={handleSaveInvitato} className="space-y-4">
          <div>
            <label className="label">Denominazione *</label>
            <input className="input" required value={invitatoForm.denominazione} onChange={(e) => setInvitatoForm({ ...invitatoForm, denominazione: e.target.value })} />
          </div>
          <div>
            <label className="label">Partita IVA</label>
            <input className="input font-mono" value={invitatoForm.partita_iva} onChange={(e) => setInvitatoForm({ ...invitatoForm, partita_iva: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={invitatoForm.offerta_presentata} onChange={(e) => setInvitatoForm({ ...invitatoForm, offerta_presentata: e.target.checked })} />
            Offerta presentata
          </label>
          {invitatoForm.offerta_presentata && (
            <div>
              <label className="label">Importo offerta (€)</label>
              <input className="input" type="number" step="0.01" value={invitatoForm.importo_offerta}
                onChange={(e) => setInvitatoForm({ ...invitatoForm, importo_offerta: parseFloat(e.target.value) || 0 })} />
            </div>
          )}
          <div>
            <label className="label">Note</label>
            <textarea className="input" rows={2} value={invitatoForm.note} onChange={(e) => setInvitatoForm({ ...invitatoForm, note: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowInvitatoModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteInvitato}
        title="Elimina invitato"
        message={`Eliminare "${deleteInvitato?.denominazione}"?`}
        confirmLabel="Elimina"
        danger
        onConfirm={() => deleteInvitato && handleDeleteInvitato(deleteInvitato)}
        onCancel={() => setDeleteInvitato(null)}
      />

      <ConfirmDialog
        open={deleteConfirm}
        title="Elimina procedura"
        message={`Eliminare la procedura "${procedura.oggetto}"? L'azione è irreversibile.`}
        confirmLabel="Elimina"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(false)}
      />
    </div>
  );
}
