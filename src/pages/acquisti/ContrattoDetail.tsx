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
import { ArrowLeft, Edit2, Trash2, Upload, Download, FileText, ExternalLink, Link2 } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
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

export default function ContrattoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [contratto, setContratto] = useState<Contratto | null>(null);
  const [procedure, setProcedure] = useState<Procedura[]>([]);
  const [interventi, setInterventi] = useState<Intervento[]>([]);
  const [allTipologie, setAllTipologie] = useState<TipologiaSpesa[]>([]);
  const [allCapitoli, setAllCapitoli] = useState<CapitoloLookup[]>([]);
  const [loading, setLoading] = useState(true);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    numero: "", oggetto: "", contraente: "", partita_iva: "",
    tipo_contratto: "Servizi", importo: 0, data_stipula: "",
    data_inizio: "", data_fine: "", procedura_id: "",
    intervento: "", tipologia_spesa: "", capitolo: "",
    cig: "", cup: "", stato: "attivo", note: "",
  });
  const [editLoading, setEditLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from("gal_contratti")
      .select("*, procedura:gal_procedure(codice, oggetto)")
      .eq("id", id)
      .single();
    setContratto(data as Contratto);
    setLoading(false);
  }

  useEffect(() => {
    load();
    if (currentGal) {
      supabase.from("gal_procedure").select("id, codice, oggetto").eq("gal_id", currentGal.id).order("codice")
        .then(({ data }) => setProcedure((data ?? []) as Procedura[]));
      supabase.from("gal_interventi").select("*").eq("gal_id", currentGal.id).order("nome")
        .then(({ data }) => setInterventi((data ?? []) as Intervento[]));
      supabase.from("gal_tipologie_spesa").select("*").eq("gal_id", currentGal.id).order("nome")
        .then(({ data }) => setAllTipologie((data ?? []) as TipologiaSpesa[]));
      supabase.from("gal_capitoli").select("*").eq("gal_id", currentGal.id).order("nome")
        .then(({ data }) => setAllCapitoli((data ?? []) as CapitoloLookup[]));
    }
  }, [id, currentGal?.id]);

  function openEditModal() {
    if (!contratto) return;
    setEditForm({
      numero: contratto.numero, oggetto: contratto.oggetto, contraente: contratto.contraente,
      partita_iva: contratto.partita_iva ?? "", tipo_contratto: contratto.tipo_contratto ?? "Servizi",
      importo: contratto.importo, data_stipula: contratto.data_stipula,
      data_inizio: contratto.data_inizio ?? "", data_fine: contratto.data_fine ?? "",
      procedura_id: contratto.procedura_id ?? "",
      intervento: contratto.intervento ?? "", tipologia_spesa: contratto.tipologia_spesa ?? "",
      capitolo: contratto.capitolo ?? "", cig: contratto.cig ?? "", cup: contratto.cup ?? "",
      stato: contratto.stato, note: contratto.note ?? "",
    });
    setShowEditModal(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !user || !currentGal) return;
    setEditLoading(true);
    const { error } = await supabase.from("gal_contratti").update({
      numero: editForm.numero, oggetto: editForm.oggetto, contraente: editForm.contraente,
      partita_iva: editForm.partita_iva || null, tipo_contratto: editForm.tipo_contratto || null,
      importo: editForm.importo, data_stipula: editForm.data_stipula,
      data_inizio: editForm.data_inizio || null, data_fine: editForm.data_fine || null,
      procedura_id: editForm.procedura_id || null,
      intervento: editForm.intervento || null, tipologia_spesa: editForm.tipologia_spesa || null,
      capitolo: editForm.capitolo || null, cig: editForm.cig || null, cup: editForm.cup || null,
      stato: editForm.stato, note: editForm.note || null,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); setEditLoading(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "contratto", descrizione: editForm.numero });
    toast.success("Contratto aggiornato");
    setShowEditModal(false); setEditLoading(false); load();
  }

  async function handleDelete() {
    if (!id || !user || !currentGal || !contratto) return;
    // Elimina documento dallo storage se presente
    if (contratto.documento_path) {
      await supabase.storage.from("documenti_gal").remove([contratto.documento_path]);
    }
    const { error } = await supabase.from("gal_contratti").delete().eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "contratto", descrizione: contratto.numero });
    toast.success("Contratto eliminato");
    navigate("/contratti");
  }

  async function handleUploadDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id || !currentGal) return;
    e.target.value = "";
    setUploading(true);

    // Rimuovi vecchio documento se presente
    if (contratto?.documento_path) {
      await supabase.storage.from("documenti_gal").remove([contratto.documento_path]);
    }

    const ext = file.name.split(".").pop() ?? "pdf";
    const storagePath = `contratti/${currentGal.id}/${id}.${ext}`;
    const { error: upErr } = await supabase.storage.from("documenti_gal").upload(storagePath, file, { upsert: true });
    if (upErr) { toast.error(messaggioErrore(upErr, "Errore upload")); setUploading(false); return; }

    const { error } = await supabase.from("gal_contratti").update({
      documento_path: storagePath, documento_nome: file.name, updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(messaggioErrore(error)); setUploading(false); return; }
    toast.success("Documento caricato");
    setUploading(false); load();
  }

  async function handleViewDoc() {
    if (!contratto?.documento_path) return;
    const { data } = await supabase.storage.from("documenti_gal").createSignedUrl(contratto.documento_path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Errore apertura documento");
  }

  async function handleDownloadDoc() {
    if (!contratto?.documento_path) return;
    const { data } = await supabase.storage.from("documenti_gal").download(contratto.documento_path);
    if (!data) { toast.error("Errore download"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(data);
    a.download = contratto.documento_nome ?? "contratto.pdf";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Cascading dropdown helpers
  const filteredTipologie = editForm.intervento
    ? allTipologie.filter((t) => { const int = interventi.find((i) => i.nome === editForm.intervento); return int ? t.intervento_id === int.id : true; })
    : [];
  const filteredCapitoli = editForm.tipologia_spesa
    ? allCapitoli.filter((c) => { const tip = allTipologie.find((t) => t.nome === editForm.tipologia_spesa); return tip ? c.tipologia_id === tip.id : true; })
    : [];

  if (loading) return <div className="p-8 text-center text-gray-500">Caricamento...</div>;
  if (!contratto) return <div className="p-8 text-center text-red-500">Contratto non trovato</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate("/contratti")} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{contratto.numero}</h1>
          <p className="text-sm text-gray-500">{contratto.oggetto}</p>
        </div>
        <span className={`badge ${STATO_COLORS[contratto.stato] ?? "bg-gray-100"}`}>{contratto.stato}</span>
        {write && (
          <div className="flex gap-2">
            <button onClick={openEditModal} className="btn-secondary"><Edit2 size={16} /> Modifica</button>
            <button onClick={() => setDeleteConfirm(true)} className="btn-secondary text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
          </div>
        )}
      </div>

      {/* Dettagli */}
      <div className="grid grid-cols-2 gap-6">
        <div className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase">Dati contratto</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">Contraente</span><span className="font-medium">{contratto.contraente}</span>
            {contratto.partita_iva && <><span className="text-gray-500">P.IVA / C.F.</span><span className="font-mono">{contratto.partita_iva}</span></>}
            <span className="text-gray-500">Tipo</span><span>{contratto.tipo_contratto ?? "-"}</span>
            <span className="text-gray-500">Importo</span><span className="font-bold text-green-700">{formatCurrency(contratto.importo)}</span>
            <span className="text-gray-500">Data stipula</span><span>{formatDate(contratto.data_stipula)}</span>
            {contratto.data_inizio && <><span className="text-gray-500">Decorrenza</span><span>{formatDate(contratto.data_inizio)}</span></>}
            {contratto.data_fine && <><span className="text-gray-500">Scadenza</span><span>{formatDate(contratto.data_fine)}</span></>}
            {contratto.cig && <><span className="text-gray-500">CIG</span><span className="font-mono">{contratto.cig}</span></>}
            {contratto.cup && <><span className="text-gray-500">CUP</span><span className="font-mono">{contratto.cup}</span></>}
          </div>
        </div>

        <div className="space-y-4">
          {/* Documento */}
          <div className="card p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase">Documento contrattuale</h2>
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleUploadDoc} />
            {contratto.documento_path ? (
              <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <FileText size={20} className="text-blue-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-800">{contratto.documento_nome ?? "Documento"}</p>
                </div>
                <button onClick={handleViewDoc} className="btn-secondary text-xs py-1 px-2"><ExternalLink size={14} /> Apri</button>
                <button onClick={handleDownloadDoc} className="btn-secondary text-xs py-1 px-2"><Download size={14} /></button>
                {write && <button onClick={() => fileInputRef.current?.click()} className="btn-secondary text-xs py-1 px-2" disabled={uploading}><Upload size={14} /> Sostituisci</button>}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-gray-400 mb-2">Nessun documento allegato</p>
                {write && (
                  <button onClick={() => fileInputRef.current?.click()} className="btn-primary text-sm" disabled={uploading}>
                    <Upload size={16} /> {uploading ? "Caricamento..." : "Carica contratto"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Collegamento procedura */}
          <div className="card p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase">Collegamento procedura</h2>
            {contratto.procedura ? (
              <Link to={`/procedure/${contratto.procedura_id}`} className="flex items-center gap-2 p-3 bg-teal-50 rounded-lg border border-teal-200 hover:bg-teal-100 transition">
                <Link2 size={16} className="text-teal-600" />
                <span className="text-sm font-medium text-teal-800">{contratto.procedura.codice} — {contratto.procedura.oggetto}</span>
                <ExternalLink size={14} className="text-teal-400 ml-auto" />
              </Link>
            ) : (
              <p className="text-sm text-gray-400">Nessuna procedura collegata</p>
            )}
          </div>

          {/* Imputazione */}
          {(contratto.intervento || contratto.capitolo) && (
            <div className="card p-5 space-y-2">
              <h2 className="text-sm font-semibold text-gray-500 uppercase">Imputazione previsione</h2>
              <div className="text-sm space-y-1">
                {contratto.intervento && <p><span className="text-gray-500">Intervento:</span> {contratto.intervento}</p>}
                {contratto.tipologia_spesa && <p><span className="text-gray-500">Tipologia:</span> {contratto.tipologia_spesa}</p>}
                {contratto.capitolo && <p><span className="text-gray-500">Capitolo:</span> {contratto.capitolo}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {contratto.note && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-2">Note</h2>
          <p className="text-sm whitespace-pre-wrap">{contratto.note}</p>
        </div>
      )}

      {/* Edit Modal */}
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Modifica Contratto" size="lg">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">Numero *</label>
              <input className="input" required value={editForm.numero} onChange={(e) => setEditForm({ ...editForm, numero: e.target.value })} /></div>
            <div><label className="label">Data stipula *</label>
              <input className="input" type="date" required value={editForm.data_stipula} onChange={(e) => setEditForm({ ...editForm, data_stipula: e.target.value })} /></div>
            <div><label className="label">Tipo contratto</label>
              <select className="input" value={editForm.tipo_contratto} onChange={(e) => setEditForm({ ...editForm, tipo_contratto: e.target.value })}>
                {TIPO_CONTRATTO_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
          </div>
          <div><label className="label">Oggetto *</label>
            <input className="input" required value={editForm.oggetto} onChange={(e) => setEditForm({ ...editForm, oggetto: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Contraente *</label>
              <input className="input" required value={editForm.contraente} onChange={(e) => setEditForm({ ...editForm, contraente: e.target.value })} /></div>
            <div><label className="label">P.IVA / C.F.</label>
              <input className="input font-mono" value={editForm.partita_iva} onChange={(e) => setEditForm({ ...editForm, partita_iva: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div><label className="label">Importo (€) *</label>
              <input className="input" type="number" step="0.01" required value={editForm.importo} onChange={(e) => setEditForm({ ...editForm, importo: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Data inizio</label>
              <input className="input" type="date" value={editForm.data_inizio} onChange={(e) => setEditForm({ ...editForm, data_inizio: e.target.value })} /></div>
            <div><label className="label">Data fine</label>
              <input className="input" type="date" value={editForm.data_fine} onChange={(e) => setEditForm({ ...editForm, data_fine: e.target.value })} /></div>
            <div><label className="label">Stato</label>
              <select className="input" value={editForm.stato} onChange={(e) => setEditForm({ ...editForm, stato: e.target.value })}>
                <option value="attivo">Attivo</option>
                <option value="scaduto">Scaduto</option>
                <option value="risolto">Risolto</option>
                <option value="annullato">Annullato</option>
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">CIG</label><input className="input font-mono" value={editForm.cig} onChange={(e) => setEditForm({ ...editForm, cig: e.target.value })} /></div>
            <div><label className="label">CUP</label><input className="input font-mono" value={editForm.cup} onChange={(e) => setEditForm({ ...editForm, cup: e.target.value })} /></div>
          </div>
          <div className="border-t pt-3">
            <label className="label">Collega a procedura</label>
            <select className="input" value={editForm.procedura_id} onChange={(e) => setEditForm({ ...editForm, procedura_id: e.target.value })}>
              <option value="">— Nessuna procedura —</option>
              {procedure.map((p) => <option key={p.id} value={p.id}>{p.codice ?? "—"} · {p.oggetto}</option>)}
            </select>
          </div>
          <div className="border-t pt-3">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Imputazione a previsione</p>
            <div className="grid grid-cols-3 gap-4">
              <div><label className="label text-xs">Intervento</label>
                <select className="input text-sm" value={editForm.intervento} onChange={(e) => setEditForm({ ...editForm, intervento: e.target.value, tipologia_spesa: "", capitolo: "" })}>
                  <option value="">— Nessuno —</option>
                  {interventi.map((i) => <option key={i.id} value={i.nome}>{i.nome}</option>)}
                </select></div>
              <div><label className="label text-xs">Tipologia Spesa</label>
                <select className="input text-sm" value={editForm.tipologia_spesa} onChange={(e) => setEditForm({ ...editForm, tipologia_spesa: e.target.value, capitolo: "" })} disabled={!editForm.intervento}>
                  <option value="">— Seleziona —</option>
                  {filteredTipologie.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
                </select></div>
              <div><label className="label text-xs">Capitolo</label>
                <select className="input text-sm" value={editForm.capitolo} onChange={(e) => setEditForm({ ...editForm, capitolo: e.target.value })} disabled={!editForm.tipologia_spesa}>
                  <option value="">— Seleziona —</option>
                  {filteredCapitoli.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
                </select></div>
            </div>
          </div>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={editLoading}>{editLoading ? "..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowEditModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={deleteConfirm} onCancel={() => setDeleteConfirm(false)} onConfirm={handleDelete}
        title="Elimina contratto" message={`Eliminare definitivamente il contratto "${contratto.numero}"? L'operazione non è reversibile.`} />
    </div>
  );
}
