// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import clsx from "clsx";
import {
  ArrowLeft, Pencil, CheckCircle2, Trash2, Plus, ArrowUp, ArrowDown, Loader2, Repeat,
  CalendarClock, MessageSquare, ListChecks, RotateCcw,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatDate, logAudit } from "../../lib/utils";
import { etichettaScadenza, oggiISO, prossimaDataRicorrenza } from "../../lib/scadenze";
import {
  FUNZIONI, FUNZIONE_COLORS, FUNZIONE_LABELS, PRIORITA_COLORS, PRIORITA_LABELS,
  RICORRENZA_LABELS, STATO_PRATICA_COLORS, STATO_PRATICA_LABELS, categoriaLabel, BUCKET_DOCUMENTI,
} from "../../constants";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import AttachmentPanel from "../../components/ui/AttachmentPanel";
import PraticaForm, { PraticaFormValues } from "../../components/agenda/PraticaForm";
import { BarraProgresso } from "./AgendaPage";
import type { ChecklistItem, Funzione, NotaPratica, PraticaAgenda } from "../../types";

export default function PraticaDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [pratica, setPratica] = useState<PraticaAgenda | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [note, setNote] = useState<NotaPratica[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmCompleta, setConfirmCompleta] = useState(false);
  const [confirmElimina, setConfirmElimina] = useState(false);
  const [voceDaEliminare, setVoceDaEliminare] = useState<ChecklistItem | null>(null);
  const [nuovaVoce, setNuovaVoce] = useState({ descrizione: "", responsabile: "" as Funzione | "", data_scadenza: "" });
  const [nuovaNota, setNuovaNota] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    const [pRes, cRes, nRes] = await Promise.all([
      supabase.from("gal_agenda_pratiche").select("*").eq("id", id).single(),
      supabase.from("gal_agenda_checklist").select("*").eq("pratica_id", id).order("ordine").order("created_at"),
      supabase.from("gal_agenda_note").select("*").eq("pratica_id", id).order("created_at", { ascending: false }),
    ]);
    if (pRes.error || !pRes.data) {
      console.error(pRes.error);
      toast.error("Pratica non trovata");
      navigate("/agenda");
      return;
    }
    setPratica(pRes.data as PraticaAgenda);
    if (cRes.error) { console.error(cRes.error); toast.error("Impossibile caricare la check list"); }
    else setChecklist((cRes.data ?? []) as ChecklistItem[]);
    if (nRes.error) console.error(nRes.error);
    else setNote((nRes.data ?? []) as NotaPratica[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  if (loading || !pratica) {
    return <div className="flex items-center justify-center gap-2 text-gray-400 py-20"><Loader2 className="animate-spin" size={18} /> Caricamento pratica…</div>;
  }

  const p = pratica;
  const fatte = checklist.filter((c) => c.completata).length;
  const perc = checklist.length ? Math.round((fatte / checklist.length) * 100) : p.stato === "completata" ? 100 : 0;
  const attiva = ["aperta", "in_corso", "sospesa"].includes(p.stato);
  const et = etichettaScadenza(p.data_scadenza);

  async function aggiornaPratica(patch: Partial<PraticaAgenda>, messaggio?: string): Promise<boolean> {
    const { error } = await supabase.from("gal_agenda_pratiche").update(patch).eq("id", p.id);
    if (error) { console.error(error); toast.error("Salvataggio non riuscito. Riprova."); return false; }
    setPratica({ ...p, ...patch });
    if (messaggio) toast.success(messaggio);
    return true;
  }

  async function handleEdit(v: PraticaFormValues) {
    const ok = await aggiornaPratica({
      titolo: v.titolo.trim(), descrizione: v.descrizione || null, categoria: v.categoria,
      responsabile: v.responsabile, priorita: v.priorita, stato: v.stato,
      data_apertura: v.data_apertura, data_scadenza: v.data_scadenza,
      data_promemoria: v.data_promemoria || null, ricorrenza: v.ricorrenza,
      riferimento: v.riferimento || null,
      data_completamento: v.stato === "completata" ? p.data_completamento ?? oggiISO() : null,
    }, "Pratica aggiornata");
    if (ok) setShowEdit(false);
  }

  async function toggleVoce(c: ChecklistItem) {
    if (!write) return;
    const completata = !c.completata;
    const patch = {
      completata,
      completata_il: completata ? new Date().toISOString() : null,
      completata_da: completata ? user?.nome_completo ?? null : null,
    };
    const { error } = await supabase.from("gal_agenda_checklist").update(patch).eq("id", c.id);
    if (error) { console.error(error); toast.error("Aggiornamento non riuscito"); return; }
    const nuova = checklist.map((x) => (x.id === c.id ? { ...x, ...patch } : x));
    setChecklist(nuova);
    // Prima spunta → la pratica passa "in corso"
    if (completata && p.stato === "aperta") await aggiornaPratica({ stato: "in_corso" });
    if (completata && nuova.every((x) => x.completata) && attiva) {
      toast.success("Tutti i passaggi completati! Puoi chiudere la pratica.", {
        action: { label: "Completa", onClick: () => setConfirmCompleta(true) },
      });
    }
  }

  async function aggiungiVoce(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !nuovaVoce.descrizione.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from("gal_agenda_checklist").insert({
      gal_id: currentGal.id,
      pratica_id: p.id,
      descrizione: nuovaVoce.descrizione.trim(),
      responsabile: nuovaVoce.responsabile || null,
      data_scadenza: nuovaVoce.data_scadenza || null,
      ordine: checklist.length ? Math.max(...checklist.map((c) => c.ordine)) + 1 : 0,
    }).select("*").single();
    setBusy(false);
    if (error || !data) { console.error(error); toast.error("Impossibile aggiungere il passaggio"); return; }
    setChecklist([...checklist, data as ChecklistItem]);
    setNuovaVoce({ descrizione: "", responsabile: "", data_scadenza: "" });
    toast.success("Passaggio aggiunto");
  }

  async function spostaVoce(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= checklist.length) return;
    const a = checklist[idx];
    const b = checklist[j];
    const lista = [...checklist];
    lista[idx] = { ...b, ordine: idx };
    lista[j] = { ...a, ordine: j };
    setChecklist(lista);
    const [r1, r2] = await Promise.all([
      supabase.from("gal_agenda_checklist").update({ ordine: j }).eq("id", a.id),
      supabase.from("gal_agenda_checklist").update({ ordine: idx }).eq("id", b.id),
    ]);
    if (r1.error || r2.error) { toast.error("Riordino non salvato"); load(); }
  }

  async function eliminaVoce() {
    if (!voceDaEliminare) return;
    const { error } = await supabase.from("gal_agenda_checklist").delete().eq("id", voceDaEliminare.id);
    setVoceDaEliminare(null);
    if (error) { console.error(error); toast.error("Eliminazione non riuscita"); return; }
    setChecklist(checklist.filter((c) => c.id !== voceDaEliminare.id));
    toast.success("Passaggio eliminato");
  }

  async function aggiungiNota(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !nuovaNota.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from("gal_agenda_note").insert({
      gal_id: currentGal.id, pratica_id: p.id, testo: nuovaNota.trim(), autore: user?.nome_completo ?? null,
    }).select("*").single();
    setBusy(false);
    if (error || !data) { console.error(error); toast.error("Nota non salvata"); return; }
    setNote([data as NotaPratica, ...note]);
    setNuovaNota("");
    toast.success("Nota aggiunta al diario");
  }

  async function completaPratica() {
    if (!currentGal || !user) return;
    setConfirmCompleta(false);
    setBusy(true);
    const ok = await aggiornaPratica({ stato: "completata", data_completamento: oggiISO() });
    if (!ok) { setBusy(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "pratica_agenda", entitaId: p.id, descrizione: `Completata: ${p.titolo}` });

    // Pratica ricorrente → genera la successiva con la stessa check list
    const prossima = prossimaDataRicorrenza(p.data_scadenza, p.ricorrenza);
    if (prossima) {
      const prom = p.data_promemoria ? prossimaDataRicorrenza(p.data_promemoria, p.ricorrenza) : null;
      const { data, error } = await supabase.from("gal_agenda_pratiche").insert({
        gal_id: p.gal_id, codice: p.codice, titolo: p.titolo, descrizione: p.descrizione,
        categoria: p.categoria, responsabile: p.responsabile, priorita: p.priorita, stato: "aperta",
        data_apertura: oggiISO(), data_scadenza: prossima, data_promemoria: prom,
        ricorrenza: p.ricorrenza, riferimento: p.riferimento, created_by: user.id,
      }).select("id").single();
      if (error || !data) {
        console.error(error);
        toast.warning("Pratica completata, ma non è stato possibile creare la ricorrenza successiva.");
      } else {
        if (checklist.length) {
          await supabase.from("gal_agenda_checklist").insert(checklist.map((c, i) => ({
            gal_id: c.gal_id, pratica_id: data.id, descrizione: c.descrizione, responsabile: c.responsabile, ordine: i,
          })));
        }
        toast.success(`Pratica completata. Creata la prossima scadenza al ${formatDate(prossima)}`, {
          action: { label: "Apri", onClick: () => navigate(`/agenda/${data.id}`) },
        });
        setBusy(false);
        return;
      }
    }
    toast.success("Pratica completata");
    setBusy(false);
  }

  async function riapriPratica() {
    await aggiornaPratica({ stato: "in_corso", data_completamento: null }, "Pratica riaperta");
  }

  async function eliminaPratica() {
    if (!currentGal || !user) return;
    const { error } = await supabase.from("gal_agenda_pratiche").delete().eq("id", p.id);
    setConfirmElimina(false);
    if (error) { console.error(error); toast.error("Eliminazione non riuscita"); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "pratica_agenda", entitaId: p.id, descrizione: p.titolo });
    toast.success("Pratica eliminata");
    navigate("/agenda");
  }

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Intestazione */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <button className="btn-ghost p-1.5 mt-0.5" onClick={() => navigate("/agenda")} title="Torna all'agenda"><ArrowLeft size={18} /></button>
          <div>
            <div className="text-xs text-gray-400">{p.codice} · {categoriaLabel(p.categoria)}</div>
            <h1 className="text-xl font-bold text-gray-900">{p.titolo}</h1>
            <div className="flex gap-2 mt-2 flex-wrap">
              <span className={clsx("badge border", FUNZIONE_COLORS[p.responsabile])}>{FUNZIONE_LABELS[p.responsabile]}</span>
              <span className={clsx("badge", PRIORITA_COLORS[p.priorita])}>Priorità {PRIORITA_LABELS[p.priorita].toLowerCase()}</span>
              <span className={clsx("badge", STATO_PRATICA_COLORS[p.stato])}>{STATO_PRATICA_LABELS[p.stato]}</span>
              {p.ricorrenza !== "nessuna" && <span className="badge bg-indigo-50 text-indigo-700"><Repeat size={11} className="mr-1" />{RICORRENZA_LABELS[p.ricorrenza]}</span>}
            </div>
          </div>
        </div>
        {write && (
          <div className="flex gap-2 flex-wrap">
            <button className="btn-secondary" onClick={() => setShowEdit(true)}><Pencil size={16} /> Modifica</button>
            {attiva ? (
              <button className="btn-primary" onClick={() => setConfirmCompleta(true)} disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Completa pratica
              </button>
            ) : p.stato === "completata" && (
              <button className="btn-secondary" onClick={riapriPratica}><RotateCcw size={16} /> Riapri</button>
            )}
            {isAdmin(user) && (
              <button className="btn-ghost text-red-600" onClick={() => setConfirmElimina(true)} title="Elimina pratica"><Trash2 size={16} /></button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Colonna principale */}
        <div className="lg:col-span-2 space-y-5">
          {p.descrizione && (
            <div className="card p-4">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.descrizione}</p>
            </div>
          )}

          {/* Check list */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2"><ListChecks size={18} /> Check list di avanzamento</h2>
              <span className="text-sm text-gray-500">{fatte}/{checklist.length} — {perc}%</span>
            </div>
            <BarraProgresso perc={perc} />
            {checklist.length === 0 && <p className="text-sm text-gray-400 py-2">Nessun passaggio definito. Aggiungi i passaggi per monitorare l'avanzamento.</p>}
            <ul className="divide-y divide-gray-100">
              {checklist.map((c, i) => {
                const etc = c.data_scadenza && !c.completata ? etichettaScadenza(c.data_scadenza) : null;
                return (
                  <li key={c.id} className="flex items-start gap-3 py-2.5 group">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-green-600 cursor-pointer" checked={c.completata}
                      onChange={() => toggleVoce(c)} disabled={!write} />
                    <div className="flex-1 min-w-0">
                      <div className={clsx("text-sm", c.completata ? "line-through text-gray-400" : "text-gray-800")}>{c.descrizione}</div>
                      <div className="flex gap-2 flex-wrap mt-0.5 text-xs text-gray-400">
                        {c.responsabile && <span className={clsx("badge border py-0", FUNZIONE_COLORS[c.responsabile])}>{FUNZIONE_LABELS[c.responsabile]}</span>}
                        {c.data_scadenza && <span>entro {formatDate(c.data_scadenza)}</span>}
                        {etc && <span className={etc.classe}>{etc.testo}</span>}
                        {c.completata && c.completata_il && <span>✓ {new Date(c.completata_il).toLocaleDateString("it-IT")}{c.completata_da ? ` — ${c.completata_da}` : ""}</span>}
                      </div>
                    </div>
                    {write && (
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="btn-ghost p-1" onClick={() => spostaVoce(i, -1)} disabled={i === 0} title="Sposta su"><ArrowUp size={14} /></button>
                        <button className="btn-ghost p-1" onClick={() => spostaVoce(i, 1)} disabled={i === checklist.length - 1} title="Sposta giù"><ArrowDown size={14} /></button>
                        <button className="btn-ghost p-1 text-red-500" onClick={() => setVoceDaEliminare(c)} title="Elimina"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {write && (
              <form onSubmit={aggiungiVoce} className="grid grid-cols-1 md:grid-cols-12 gap-2 pt-2 border-t">
                <input className="input md:col-span-6" placeholder="Nuovo passaggio…" value={nuovaVoce.descrizione}
                  onChange={(e) => setNuovaVoce({ ...nuovaVoce, descrizione: e.target.value })} />
                <select className="input md:col-span-3" value={nuovaVoce.responsabile}
                  onChange={(e) => setNuovaVoce({ ...nuovaVoce, responsabile: e.target.value as Funzione | "" })}>
                  <option value="">Responsabile…</option>
                  {FUNZIONI.map((f) => <option key={f} value={f}>{FUNZIONE_LABELS[f]}</option>)}
                </select>
                <input type="date" className="input md:col-span-2" value={nuovaVoce.data_scadenza} title="Entro il"
                  onChange={(e) => setNuovaVoce({ ...nuovaVoce, data_scadenza: e.target.value })} />
                <button type="submit" className="btn-primary md:col-span-1 justify-center" disabled={busy || !nuovaVoce.descrizione.trim()} title="Aggiungi"><Plus size={16} /></button>
              </form>
            )}
          </div>

          {/* Diario */}
          <div className="card p-4 space-y-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><MessageSquare size={18} /> Diario della pratica</h2>
            {write && (
              <form onSubmit={aggiungiNota} className="flex gap-2">
                <input className="input" placeholder="Annota un aggiornamento (es. inviata PEC, in attesa di riscontro…)" value={nuovaNota} onChange={(e) => setNuovaNota(e.target.value)} />
                <button type="submit" className="btn-secondary" disabled={busy || !nuovaNota.trim()}>Aggiungi</button>
              </form>
            )}
            {note.length === 0 && <p className="text-sm text-gray-400">Nessuna annotazione</p>}
            <ul className="space-y-2">
              {note.map((n) => (
                <li key={n.id} className="border-l-2 border-primary-300 pl-3">
                  <div className="text-sm text-gray-800 whitespace-pre-wrap">{n.testo}</div>
                  <div className="text-xs text-gray-400">{new Date(n.created_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}{n.autore ? ` — ${n.autore}` : ""}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Colonna laterale */}
        <div className="space-y-5">
          <div className="card p-4 space-y-3 text-sm">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><CalendarClock size={18} /> Tempistiche</h2>
            <Riga label="Aperta il" value={formatDate(p.data_apertura)} />
            <Riga label="Scadenza" value={<span className="font-semibold">{formatDate(p.data_scadenza)}</span>} />
            {attiva && <Riga label="" value={<span className={et.classe}>{et.testo}</span>} />}
            {p.data_promemoria && <Riga label="Promemoria dal" value={formatDate(p.data_promemoria)} />}
            {p.data_completamento && <Riga label="Completata il" value={formatDate(p.data_completamento)} />}
            <Riga label="Ricorrenza" value={RICORRENZA_LABELS[p.ricorrenza]} />
            {p.riferimento && <Riga label="Riferimento" value={p.riferimento} />}
          </div>
          <div className="card p-4">
            <AttachmentPanel bucket={BUCKET_DOCUMENTI} entityType="agenda" entityId={p.id} readonly={!write} />
          </div>
        </div>
      </div>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Modifica pratica" size="xl">
        <PraticaForm
          modalita="modifica"
          initial={{
            titolo: p.titolo, descrizione: p.descrizione ?? "", categoria: p.categoria, responsabile: p.responsabile,
            priorita: p.priorita, stato: p.stato, data_apertura: p.data_apertura, data_scadenza: p.data_scadenza,
            data_promemoria: p.data_promemoria ?? "", ricorrenza: p.ricorrenza, riferimento: p.riferimento ?? "",
            note: p.note ?? "", checklist: [],
          }}
          onSubmit={handleEdit}
          onCancel={() => setShowEdit(false)}
        />
      </Modal>

      <ConfirmDialog
        open={confirmCompleta}
        title="Completare la pratica?"
        message={
          (checklist.length && fatte < checklist.length
            ? `Attenzione: ${checklist.length - fatte} passaggi della check list non sono ancora spuntati. `
            : "") +
          (p.ricorrenza !== "nessuna" ? "Verrà creata automaticamente la scadenza successiva." : "La pratica verrà chiusa.")
        }
        confirmLabel="Completa"
        onConfirm={completaPratica}
        onCancel={() => setConfirmCompleta(false)}
      />
      <ConfirmDialog
        open={confirmElimina}
        danger
        title="Eliminare la pratica?"
        message="Verranno eliminati anche check list e diario. L'operazione non è reversibile."
        confirmLabel="Elimina"
        onConfirm={eliminaPratica}
        onCancel={() => setConfirmElimina(false)}
      />
      <ConfirmDialog
        open={!!voceDaEliminare}
        danger
        title="Eliminare il passaggio?"
        message={voceDaEliminare?.descrizione ?? ""}
        confirmLabel="Elimina"
        onConfirm={eliminaVoce}
        onCancel={() => setVoceDaEliminare(null)}
      />
    </div>
  );
}

function Riga({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  );
}
