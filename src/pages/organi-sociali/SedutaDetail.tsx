// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Pencil, Upload, Download, FileText } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import type { Seduta, Delibera } from "../../types";

const ESITO_COLORS: Record<string, string> = {
  approvata: "bg-green-100 text-green-700",
  respinta:  "bg-red-100 text-red-600",
  ritirata:  "bg-gray-100 text-gray-500",
};

const DEFAULT_ORGANI = [
  { id: "__assemblea_soci", nome: "Assemblea Soci" },
  { id: "__consiglio_amministrazione", nome: "Consiglio di Amministrazione" },
  { id: "__revisori", nome: "Revisori" },
];

const FORM_DEL_INIT = { numero: "", anno: new Date().getFullYear(), oggetto: "", testo: "", esito: "approvata", data_delibera: "", note: "" };

export default function SedutaDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [seduta, setSeduta] = useState<Seduta | null>(null);
  const [delibere, setDelibere] = useState<Delibera[]>([]);
  const [organi, setOrgani] = useState<{ id: string; nome: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDelibera, setShowDelibera] = useState(false);
  const [formDel, setFormDel] = useState(FORM_DEL_INIT);
  const [editingDelibera, setEditingDelibera] = useState<Delibera | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showDeleteDelibera, setShowDeleteDelibera] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [verbaleUrl, setVerbaleUrl] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    const { data: s } = await supabase.from("gal_sedute").select("*, gal_organi(nome)").eq("id", id).single();
    setSeduta(s as Seduta);

    // Load organi for display
    if (s?.gal_id) {
      const { data: organiData } = await supabase.from("gal_organi").select("id, nome").eq("gal_id", s.gal_id).order("nome");
      setOrgani(organiData && organiData.length > 0 ? organiData : []);
    }

    const { data: d } = await supabase.from("gal_delibere").select("*").eq("seduta_id", id).order("numero");
    setDelibere((d ?? []) as Delibera[]);

    // Load verbale signed URL if path exists
    const sedutaAny = s as Record<string, unknown> | null;
    if (sedutaAny?.verbale_path && typeof sedutaAny.verbale_path === "string") {
      const { data: urlData } = await supabase.storage
        .from("documenti_gal")
        .createSignedUrl(sedutaAny.verbale_path, 3600);
      setVerbaleUrl(urlData?.signedUrl ?? null);
    } else {
      setVerbaleUrl(null);
    }

    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  // Get organo name for display
  function getOrganoNome(): string {
    const sedutaAny = seduta as Seduta & { gal_organi?: { nome: string } };
    if (sedutaAny?.gal_organi?.nome) return sedutaAny.gal_organi.nome;
    // Fallback: check DB organi then hardcoded defaults
    if (seduta?.organo_id) {
      const fromDb = organi.find(o => o.id === seduta.organo_id);
      if (fromDb) return fromDb.nome;
      const fromDefaults = DEFAULT_ORGANI.find(o => o.id === seduta.organo_id);
      if (fromDefaults) return fromDefaults.nome;
    }
    return "Organo non specificato";
  }

  async function handleUpdateStato(stato: string) {
    if (!id || !user || !currentGal) return;
    await supabase.from("gal_sedute").update({ stato, updated_at: new Date().toISOString() }).eq("id", id);
    toast.success("Stato aggiornato");
    load();
  }

  async function handleDeleteSeduta() {
    if (!id || !user || !currentGal) return;
    await supabase.from("gal_sedute").delete().eq("id", id);
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "seduta", entitaId: id });
    toast.success("Seduta eliminata");
    navigate("/sedute");
  }

  // --- Delibere CRUD ---
  function openAddDelibera() {
    setEditingDelibera(null);
    setFormDel(FORM_DEL_INIT);
    setShowDelibera(true);
  }

  function openEditDelibera(d: Delibera) {
    setEditingDelibera(d);
    setFormDel({
      numero: d.numero?.toString() ?? "",
      anno: d.anno ?? new Date().getFullYear(),
      oggetto: d.oggetto ?? "",
      testo: d.testo ?? "",
      esito: d.esito ?? "approvata",
      data_delibera: d.data_delibera ?? "",
      note: d.note ?? "",
    });
    setShowDelibera(true);
  }

  async function handleSaveDelibera(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !currentGal || !user) return;
    setSaving(true);

    if (editingDelibera) {
      // Update existing
      const { error } = await supabase.from("gal_delibere").update({
        numero: formDel.numero,
        anno: formDel.anno,
        oggetto: formDel.oggetto,
        testo: formDel.testo || null,
        esito: formDel.esito as Delibera["esito"],
        data_delibera: formDel.data_delibera || null,
        note: formDel.note || null,
        updated_at: new Date().toISOString(),
      }).eq("id", editingDelibera.id);
      if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
      await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "delibera", entitaId: editingDelibera.id, descrizione: `Delibera ${formDel.numero}` });
      toast.success("Delibera aggiornata");
    } else {
      // Insert new
      const { error } = await supabase.from("gal_delibere").insert({
        gal_id: currentGal.id, seduta_id: id,
        numero: formDel.numero, anno: formDel.anno, oggetto: formDel.oggetto,
        testo: formDel.testo || null, esito: formDel.esito as Delibera["esito"],
        data_delibera: formDel.data_delibera || null, note: formDel.note || null,
      });
      if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
      await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "delibera", descrizione: `Delibera ${formDel.numero}` });
      toast.success("Delibera aggiunta");
    }

    setShowDelibera(false); setSaving(false); setFormDel(FORM_DEL_INIT); setEditingDelibera(null); load();
  }

  async function handleDeleteDelibera() {
    if (!showDeleteDelibera || !currentGal || !user) return;
    const { error } = await supabase.from("gal_delibere").delete().eq("id", showDeleteDelibera);
    if (error) { toast.error(messaggioErrore(error)); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "delibera", entitaId: showDeleteDelibera });
    toast.success("Delibera eliminata");
    setShowDeleteDelibera(null);
    load();
  }

  // --- Verbale upload ---
  async function handleVerbaleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id || !currentGal || !user) return;

    setUploading(true);
    const filePath = `verbali/${id}/${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("documenti_gal")
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      toast.error(messaggioErrore(uploadError, "Errore upload"));
      setUploading(false);
      return;
    }

    // Save reference on seduta record - schema-cache fallback
    const updatePayload: Record<string, unknown> = {
      verbale_path: filePath,
      verbale_nome: file.name,
      updated_at: new Date().toISOString(),
    };

    let result = await supabase.from("gal_sedute").update(updatePayload).eq("id", id);
    if (result.error && result.error.message.includes("schema cache")) {
      // Retry without new columns - just update updated_at
      result = await supabase.from("gal_sedute").update({ updated_at: new Date().toISOString() }).eq("id", id);
    }

    if (result.error) {
      toast.error(messaggioErrore(result.error, "Errore salvataggio riferimento"));
    } else {
      await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "seduta", entitaId: id, descrizione: `Caricato verbale: ${file.name}` });
      toast.success("Verbale caricato");
    }

    setUploading(false);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
    load();
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Caricamento...</div>;
  if (!seduta) return <div className="p-8 text-center text-gray-400">Seduta non trovata</div>;

  const sedutaAny = seduta as unknown as Record<string, unknown>;
  const ordineDelGiorno = typeof sedutaAny.ordine_del_giorno === "string" ? sedutaAny.ordine_del_giorno : null;
  const verbaleNome = typeof sedutaAny.verbale_nome === "string" ? sedutaAny.verbale_nome : null;
  const verbalePath = typeof sedutaAny.verbale_path === "string" ? sedutaAny.verbale_path : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button className="btn-ghost" onClick={() => navigate("/sedute")}><ArrowLeft size={16} /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Seduta {seduta.numero ? `#${seduta.numero}` : ""} del {formatDate(seduta.data_seduta)}</h1>
          <p className="text-sm text-gray-500">{getOrganoNome()} - {seduta.luogo ?? ""}</p>
        </div>
        <div className="flex gap-2">
          {write && (
            <select className="input text-sm w-36" value={seduta.stato} onChange={(e) => handleUpdateStato(e.target.value)}>
              <option value="convocata">Convocata</option>
              <option value="tenuta">Tenuta</option>
              <option value="deserta">Deserta</option>
            </select>
          )}
          {admin && <button className="btn-danger" onClick={() => setShowDelete(true)}><Trash2 size={16} /></button>}
        </div>
      </div>

      {/* Info card */}
      <div className="card p-5">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div><p className="text-xs text-gray-400 uppercase">Data</p><p className="font-medium">{formatDate(seduta.data_seduta)}</p></div>
          <div><p className="text-xs text-gray-400 uppercase">Tipo</p><p className="capitalize">{seduta.tipo ?? "-"}</p></div>
          <div><p className="text-xs text-gray-400 uppercase">Luogo</p><p>{seduta.luogo ?? "-"}</p></div>
          <div><p className="text-xs text-gray-400 uppercase">Quorum</p><p>{seduta.quorum_presente ? `${seduta.quorum_presente}%` : "-"}</p></div>
          {seduta.note && <div className="col-span-4"><p className="text-xs text-gray-400 uppercase">Note</p><p>{seduta.note}</p></div>}
        </div>
      </div>

      {/* Ordine del Giorno */}
      {ordineDelGiorno && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Ordine del Giorno</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{ordineDelGiorno}</p>
        </div>
      )}

      {/* Allegato Verbale */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-3">Allegato Verbale</h2>
        {verbalePath && verbaleNome ? (
          <div className="flex items-center gap-3">
            <FileText size={18} className="text-blue-600" />
            <span className="text-sm font-medium">{verbaleNome}</span>
            {verbaleUrl && (
              <a href={verbaleUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm inline-flex items-center gap-1">
                <Download size={14} /> Scarica
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 mb-3">Nessun verbale caricato</p>
        )}
        {write && (
          <div className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.png,.tif"
              onChange={handleVerbaleUpload}
            />
            <button
              className="btn-secondary text-sm inline-flex items-center gap-1"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} /> {uploading ? "Caricamento..." : verbalePath ? "Sostituisci verbale" : "Carica verbale"}
            </button>
          </div>
        )}
      </div>

      {/* Delibere */}
      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Delibere ({delibere.length})</h2>
          {write && <button className="btn-primary" onClick={openAddDelibera}><Plus size={15} /> Aggiungi delibera</button>}
        </div>
        {delibere.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Nessuna delibera registrata</div>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-gray-100">
              <th className="table-header text-left">N. Delibera</th>
              <th className="table-header text-left">Oggetto</th>
              <th className="table-header text-center">Esito</th>
              <th className="table-header text-left">Data</th>
              {write && <th className="table-header text-center w-24">Azioni</th>}
            </tr></thead>
            <tbody>
              {delibere.map((d) => (
                <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="table-cell font-mono text-sm font-semibold">{d.numero}</td>
                  <td className="table-cell">{d.oggetto}</td>
                  <td className="table-cell text-center"><span className={`badge ${ESITO_COLORS[d.esito ?? ""] ?? "bg-gray-100"}`}>{d.esito ?? "-"}</span></td>
                  <td className="table-cell">{formatDate(d.data_delibera)}</td>
                  {write && (
                    <td className="table-cell text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button className="p-1 rounded hover:bg-blue-50 text-blue-600" title="Modifica" onClick={() => openEditDelibera(d)}><Pencil size={14} /></button>
                        {admin && <button className="p-1 rounded hover:bg-red-50 text-red-600" title="Elimina" onClick={() => setShowDeleteDelibera(d.id)}><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal add/edit delibera */}
      <Modal open={showDelibera} onClose={() => { setShowDelibera(false); setEditingDelibera(null); }} title={editingDelibera ? "Modifica Delibera" : "Aggiungi Delibera"} size="lg">
        <form onSubmit={handleSaveDelibera} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Numero delibera *</label><input className="input" required value={formDel.numero} onChange={(e) => setFormDel({ ...formDel, numero: e.target.value })} /></div>
            <div><label className="label">Anno</label><input className="input" type="number" value={formDel.anno} onChange={(e) => setFormDel({ ...formDel, anno: parseInt(e.target.value) || new Date().getFullYear() })} /></div>
            <div className="col-span-2"><label className="label">Oggetto *</label><input className="input" required value={formDel.oggetto} onChange={(e) => setFormDel({ ...formDel, oggetto: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Testo</label><textarea className="input" rows={4} value={formDel.testo} onChange={(e) => setFormDel({ ...formDel, testo: e.target.value })} /></div>
            <div>
              <label className="label">Esito</label>
              <select className="input" value={formDel.esito} onChange={(e) => setFormDel({ ...formDel, esito: e.target.value })}>
                <option value="approvata">Approvata</option>
                <option value="respinta">Respinta</option>
                <option value="ritirata">Ritirata</option>
              </select>
            </div>
            <div><label className="label">Data delibera</label><input className="input" type="date" value={formDel.data_delibera} onChange={(e) => setFormDel({ ...formDel, data_delibera: e.target.value })} /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : editingDelibera ? "Salva modifiche" : "Aggiungi delibera"}</button>
            <button type="button" className="btn-secondary" onClick={() => { setShowDelibera(false); setEditingDelibera(null); }}>Annulla</button>
          </div>
        </form>
      </Modal>

      {/* Confirm delete delibera */}
      <ConfirmDialog open={!!showDeleteDelibera} title="Elimina delibera" message="Eliminare questa delibera? L'operazione non puo' essere annullata." confirmLabel="Elimina" danger onConfirm={handleDeleteDelibera} onCancel={() => setShowDeleteDelibera(null)} />

      <ConfirmDialog open={showDelete} title="Elimina seduta" message="Eliminare questa seduta e tutte le delibere associate?" confirmLabel="Elimina" danger onConfirm={handleDeleteSeduta} onCancel={() => setShowDelete(false)} />
    </div>
  );
}
