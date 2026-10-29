// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import clsx from "clsx";
import {
  ArrowLeft, Pencil, Trash2, Loader2, CheckCircle2, Circle, CircleDashed, CircleDot,
  ListChecks, ScrollText, Link2, Plus,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { oggiISO } from "../../lib/scadenze";
import {
  BUCKET_DOCUMENTI, GUIDA_FASI_SCHEMA, STATO_FASE_COLORS, STATO_FASE_LABELS,
  STATO_SCHEMA_COLORS, STATO_SCHEMA_LABELS,
} from "../../constants";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import AttachmentPanel from "../../components/ui/AttachmentPanel";
import { BarraProgresso } from "../agenda/AgendaPage";
import { avanzamentoSchema, codiceSchema } from "./SchemiBandoList";
import type { Bando, FaseSchemaBando, SchemaBando, StatoFaseSchema, StatoSchemaBando } from "../../types";

/** Passaggio la cui conclusione rende il bando "pubblicato" */
const FASE_PUBBLICAZIONE = 8;
/** Passaggio di approvazione definitiva: da qui il bando passa in «Bandi attivi» */
const FASE_APPROVAZIONE_DEFINITIVA = 5;
const FASE_RNA = 9;

const ICONA_FASE: Record<StatoFaseSchema, React.ReactNode> = {
  da_fare: <Circle size={22} className="text-gray-400" aria-hidden="true" />,
  in_corso: <CircleDot size={22} className="text-blue-600" aria-hidden="true" />,
  completata: <CheckCircle2 size={22} className="text-green-600" aria-hidden="true" />,
  non_applicabile: <CircleDashed size={22} className="text-gray-300" aria-hidden="true" />,
};

type FormFase = Pick<FaseSchemaBando, "stato"> & { data_avvio: string; data_completamento: string; riferimento: string; note: string };

export default function SchemaBandoDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  const [schema, setSchema] = useState<SchemaBando | null>(null);
  const [fasi, setFasi] = useState<FaseSchemaBando[]>([]);
  const [bando, setBando] = useState<Pick<Bando, "id" | "numero" | "titolo" | "stato"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [formSchema, setFormSchema] = useState<Partial<SchemaBando>>({});
  const [faseAperta, setFaseAperta] = useState<FaseSchemaBando | null>(null);
  const [formFase, setFormFase] = useState<FormFase | null>(null);
  const [confirmElimina, setConfirmElimina] = useState(false);
  const [confirmCreaBando, setConfirmCreaBando] = useState(false);
  const [showCollega, setShowCollega] = useState(false);
  const [bandiDisponibili, setBandiDisponibili] = useState<Pick<Bando, "id" | "numero" | "titolo">[]>([]);
  const [bandoScelto, setBandoScelto] = useState("");

  async function load() {
    if (!id) return;
    const [sRes, fRes] = await Promise.all([
      supabase.from("gal_schemi_bando").select("*").eq("id", id).single(),
      supabase.from("gal_schemi_bando_fasi").select("*").eq("schema_id", id).order("numero"),
    ]);
    if (sRes.error || !sRes.data) {
      console.error(sRes.error);
      toast.error("Schema di bando non trovato");
      navigate("/schemi-bando");
      return;
    }
    const s = sRes.data as SchemaBando;
    setSchema(s);
    if (fRes.error) { toast.error(messaggioErrore(fRes.error, "Impossibile caricare i passaggi dell'iter")); }
    else setFasi((fRes.data ?? []) as FaseSchemaBando[]);
    if (s.bando_id) {
      const { data, error } = await supabase.from("gal_bandi").select("id, numero, titolo, stato").eq("id", s.bando_id).maybeSingle();
      if (error) console.error(error);
      setBando((data ?? null) as Pick<Bando, "id" | "numero" | "titolo" | "stato"> | null);
    } else setBando(null);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  if (loading || !schema) {
    return <div className="flex items-center justify-center gap-2 text-gray-500 py-20" role="status"><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Caricamento schema di bando…</div>;
  }

  const s = schema;
  const av = avanzamentoSchema(fasi);
  const faseDefinitiva = fasi.find((f) => f.numero === FASE_APPROVAZIONE_DEFINITIVA);

  async function aggiornaSchema(patch: Partial<SchemaBando>, messaggio?: string): Promise<boolean> {
    const { error } = await supabase.from("gal_schemi_bando").update(patch).eq("id", s.id);
    if (error) { toast.error(messaggioErrore(error, "Salvataggio non riuscito")); return false; }
    setSchema({ ...s, ...patch });
    if (messaggio) toast.success(messaggio);
    return true;
  }

  /** Salva un passaggio e allinea lo stato dello schema (pubblicato ⇄ in corso) */
  async function salvaFase(f: FaseSchemaBando, patch: Partial<FaseSchemaBando>, messaggio: string): Promise<boolean> {
    const { error } = await supabase.from("gal_schemi_bando_fasi").update(patch).eq("id", f.id);
    if (error) { toast.error(messaggioErrore(error, "Passaggio non salvato")); return false; }
    const nuove = fasi.map((x) => (x.id === f.id ? { ...x, ...patch } : x));
    setFasi(nuove);
    if (currentGal && user) {
      await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "schema_bando", entitaId: s.id, descrizione: `${s.titolo} — passaggio ${f.numero}: ${STATO_FASE_LABELS[(patch.stato ?? f.stato) as StatoFaseSchema]}` });
    }
    const pubblicazione = nuove.find((x) => x.numero === FASE_PUBBLICAZIONE);
    if (pubblicazione?.stato === "completata" && s.stato === "in_corso") {
      await aggiornaSchema({ stato: "pubblicato" }, "Bando pubblicato: lo schema passa allo stato «Pubblicato»");
    } else if (pubblicazione?.stato !== "completata" && s.stato === "pubblicato") {
      await aggiornaSchema({ stato: "in_corso" });
    }
    toast.success(messaggio);
    if (f.numero === FASE_APPROVAZIONE_DEFINITIVA && patch.stato === "completata" && !s.bando_id) {
      toast.info("Approvazione definitiva registrata: ora puoi creare il bando in «Bandi attivi».", {
        action: { label: "Crea bando", onClick: () => setConfirmCreaBando(true) },
      });
    }
    return true;
  }

  async function completaRapido(f: FaseSchemaBando) {
    await salvaFase(f, {
      stato: "completata",
      data_completamento: f.data_completamento ?? oggiISO(),
      completata_da: user?.nome_completo ?? null,
    }, `Passaggio ${f.numero} completato`);
  }

  function apriFase(f: FaseSchemaBando) {
    setFaseAperta(f);
    setFormFase({
      stato: f.stato, data_avvio: f.data_avvio ?? "", data_completamento: f.data_completamento ?? "",
      riferimento: f.riferimento ?? "", note: f.note ?? "",
    });
  }

  async function handleSalvaFase(e: React.FormEvent) {
    e.preventDefault();
    if (!faseAperta || !formFase) return;
    if (formFase.stato === "completata" && !formFase.data_completamento) {
      toast.error("Indica la data in cui il passaggio è stato completato");
      return;
    }
    setBusy(true);
    const completata = formFase.stato === "completata";
    const ok = await salvaFase(faseAperta, {
      stato: formFase.stato,
      data_avvio: formFase.data_avvio || null,
      data_completamento: completata ? formFase.data_completamento : null,
      riferimento: formFase.riferimento.trim() || null,
      note: formFase.note.trim() || null,
      completata_da: completata ? faseAperta.completata_da ?? user?.nome_completo ?? null : null,
    }, `Passaggio ${faseAperta.numero} aggiornato`);
    setBusy(false);
    if (ok) { setFaseAperta(null); setFormFase(null); }
  }

  function apriModifica() {
    setFormSchema({ ...s });
    setShowEdit(true);
  }

  async function handleSalvaSchema(e: React.FormEvent) {
    e.preventDefault();
    if (!formSchema.titolo?.trim()) return;
    setBusy(true);
    const deMinimis = !!formSchema.de_minimis;
    const ok = await aggiornaSchema({
      titolo: formSchema.titolo.trim(),
      intervento: (formSchema.intervento ?? "").trim() || "SRG06",
      sottointervento: formSchema.sottointervento?.trim() || null,
      azione: formSchema.azione?.trim() || null,
      descrizione: formSchema.descrizione?.trim() || null,
      dotazione_finanziaria: formSchema.dotazione_finanziaria ?? 0,
      de_minimis: deMinimis,
      stato: formSchema.stato ?? s.stato,
      note: formSchema.note?.trim() || null,
    }, "Schema di bando aggiornato");
    // Il passaggio RNA vale solo per i contributi in de minimis
    const rna = fasi.find((f) => f.numero === FASE_RNA);
    if (ok && rna && deMinimis !== s.de_minimis && rna.stato !== "completata") {
      const stato: StatoFaseSchema = deMinimis ? "da_fare" : "non_applicabile";
      const { error } = await supabase.from("gal_schemi_bando_fasi").update({ stato }).eq("id", rna.id);
      if (error) toast.error(messaggioErrore(error, "Passaggio RNA non aggiornato"));
      else setFasi(fasi.map((f) => (f.id === rna.id ? { ...f, stato } : f)));
    }
    setBusy(false);
    if (ok) setShowEdit(false);
  }

  async function creaBando() {
    if (!currentGal || !user) return;
    setConfirmCreaBando(false);
    setBusy(true);
    const { data, error } = await supabase.from("gal_bandi").insert({
      gal_id: currentGal.id,
      titolo: s.titolo,
      tipologia_operazione: codiceSchema(s),
      descrizione: s.descrizione,
      dotazione_finanziaria: s.dotazione_finanziaria,
      stato: "bozza",
    }).select("id, numero, titolo, stato").single();
    if (error || !data) { setBusy(false); toast.error(messaggioErrore(error, "Impossibile creare il bando")); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "bando", entitaId: data.id, descrizione: `Creato bando dallo schema: ${s.titolo}` });
    const ok = await aggiornaSchema({ bando_id: data.id });
    setBusy(false);
    if (!ok) return;
    setBando(data as Pick<Bando, "id" | "numero" | "titolo" | "stato">);
    toast.success("Bando creato in «Bandi attivi» (stato bozza). Completa numero e date di apertura.", {
      action: { label: "Apri bando", onClick: () => navigate(`/bandi/${data.id}`) },
    });
  }

  async function apriCollega() {
    const { data, error } = await supabase.from("gal_bandi").select("id, numero, titolo").order("created_at", { ascending: false });
    if (error) { toast.error(messaggioErrore(error, "Impossibile caricare i bandi")); return; }
    setBandiDisponibili((data ?? []) as Pick<Bando, "id" | "numero" | "titolo">[]);
    setBandoScelto("");
    setShowCollega(true);
  }

  async function collegaBando(e: React.FormEvent) {
    e.preventDefault();
    if (!bandoScelto) return;
    if (await aggiornaSchema({ bando_id: bandoScelto }, "Bando definitivo collegato")) {
      setShowCollega(false);
      load();
    }
  }

  async function scollegaBando() {
    if (await aggiornaSchema({ bando_id: null }, "Collegamento al bando rimosso")) setBando(null);
  }

  async function eliminaSchema() {
    if (!currentGal || !user) return;
    setConfirmElimina(false);
    // Allegati dei passaggi e generali (cartelle schemi_bando/<id>/…)
    const cartelle = ["generale", ...fasi.map((f) => `fase-${f.numero}`)].map((c) => `schemi_bando/${s.id}/${c}`);
    const percorsi: string[] = [];
    for (const c of cartelle) {
      const { data } = await supabase.storage.from(BUCKET_DOCUMENTI).list(c);
      (data ?? []).forEach((o) => percorsi.push(`${c}/${o.name}`));
    }
    const { error } = await supabase.from("gal_schemi_bando").delete().eq("id", s.id);
    if (error) { toast.error(messaggioErrore(error, "Eliminazione non riuscita")); return; }
    if (percorsi.length) {
      const { error: errFile } = await supabase.storage.from(BUCKET_DOCUMENTI).remove(percorsi);
      if (errFile) console.error("Allegati non rimossi", errFile);
    }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "schema_bando", entitaId: s.id, descrizione: s.titolo });
    toast.success("Schema di bando eliminato");
    navigate("/schemi-bando");
  }

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Intestazione */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <button className="btn-ghost p-1.5 mt-0.5" onClick={() => navigate("/schemi-bando")} aria-label="Torna agli schemi di bando" title="Torna agli schemi di bando">
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <div>
            <div className="text-sm text-gray-600">{codiceSchema(s)}</div>
            <h1 className="text-xl font-bold text-gray-900">{s.titolo}</h1>
            <div className="flex gap-2 mt-2 flex-wrap">
              <span className={clsx("badge", STATO_SCHEMA_COLORS[s.stato])}>{STATO_SCHEMA_LABELS[s.stato]}</span>
              {s.de_minimis && <span className="badge bg-indigo-50 text-indigo-800">Regime de minimis</span>}
            </div>
          </div>
        </div>
        {write && (
          <div className="flex gap-2 flex-wrap">
            <button className="btn-secondary" onClick={apriModifica}><Pencil size={16} aria-hidden="true" /> Modifica</button>
            {admin && (
              <button className="btn-ghost text-red-700" onClick={() => setConfirmElimina(true)} aria-label="Elimina schema di bando" title="Elimina schema di bando">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Iter */}
        <section className="lg:col-span-2 card p-4 space-y-3" aria-labelledby="titolo-iter">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 id="titolo-iter" className="font-semibold text-gray-900 flex items-center gap-2"><ListChecks size={18} aria-hidden="true" /> Iter di approvazione</h2>
            <span className="text-sm text-gray-600">{av.fatte}/{av.totale} passaggi — {av.perc}%</span>
          </div>
          <div role="progressbar" aria-label="Avanzamento dell'iter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={av.perc}>
            <BarraProgresso perc={av.perc} />
          </div>
          {fasi.length === 0 && <p className="text-sm text-gray-600">Nessun passaggio trovato per questo schema.</p>}
          <ol className="divide-y divide-gray-100">
            {fasi.map((f) => {
              const guida = GUIDA_FASI_SCHEMA[f.numero];
              const corrente = av.prossima?.numero === f.numero;
              return (
                <li key={f.id} className={clsx("py-3 flex gap-3", corrente && "bg-blue-50/60 -mx-4 px-4", f.stato === "non_applicabile" && "opacity-70")}
                  aria-current={corrente ? "step" : undefined}>
                  <div className="pt-0.5">{ICONA_FASE[f.stato]}</div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900">
                        {f.numero}. {f.titolo}
                        {corrente && <span className="ml-2 text-xs font-medium text-blue-800">(prossimo passaggio)</span>}
                      </h3>
                      <span className={clsx("badge", STATO_FASE_COLORS[f.stato])}>{STATO_FASE_LABELS[f.stato]}</span>
                    </div>
                    <div className="text-xs text-gray-600 flex gap-x-3 gap-y-0.5 flex-wrap">
                      {f.soggetto && <span>Chi: {f.soggetto}</span>}
                      {f.canale && <span>Come: {f.canale}</span>}
                    </div>
                    {(f.data_avvio || f.data_completamento || f.riferimento) && (
                      <dl className="text-xs text-gray-700 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-2">
                        {f.data_avvio && <><dt className="text-gray-500">Avviato il</dt><dd>{formatDate(f.data_avvio)}</dd></>}
                        {f.data_completamento && <><dt className="text-gray-500">Completato il</dt><dd>{formatDate(f.data_completamento)}{f.completata_da ? ` — ${f.completata_da}` : ""}</dd></>}
                        {f.riferimento && <><dt className="text-gray-500">Riferimento</dt><dd className="break-words">{f.riferimento}</dd></>}
                      </dl>
                    )}
                    {f.note && <p className="text-xs text-gray-700 whitespace-pre-wrap">{f.note}</p>}
                    {guida && (
                      <details className="text-xs text-gray-600" open={corrente}>
                        <summary className="cursor-pointer text-primary-700 hover:underline w-fit">Cosa prevede questo passaggio</summary>
                        <p className="mt-1">{guida.cosa}</p>
                      </details>
                    )}
                    {write && (
                      <div className="flex gap-2 pt-1 flex-wrap">
                        <button className="btn-secondary text-xs py-1" onClick={() => apriFase(f)}>
                          Aggiorna passaggio {f.numero}
                        </button>
                        {f.stato !== "completata" && f.stato !== "non_applicabile" && (
                          <button className="btn-ghost text-xs py-1 text-green-800" onClick={() => completaRapido(f)}>
                            <CheckCircle2 size={14} aria-hidden="true" /> Segna completato oggi
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Colonna laterale */}
        <div className="space-y-5">
          <section className="card p-4 space-y-3 text-sm" aria-labelledby="titolo-bando-def">
            <h2 id="titolo-bando-def" className="font-semibold text-gray-900 flex items-center gap-2"><ScrollText size={18} aria-hidden="true" /> Bando definitivo</h2>
            {bando ? (
              <>
                <p>
                  <Link to={`/bandi/${bando.id}`} className="text-primary-700 font-medium hover:underline">
                    {bando.numero ? `Bando n. ${bando.numero}` : bando.titolo}
                  </Link>
                  <span className="text-gray-600"> — gestito in «Bandi attivi» (stato: {bando.stato})</span>
                </p>
                {write && <button className="btn-ghost text-xs" onClick={scollegaBando}>Rimuovi collegamento</button>}
              </>
            ) : (
              <>
                <p className="text-gray-700">
                  {faseDefinitiva?.stato === "completata"
                    ? "Il CdA ha approvato il bando definitivo: crealo in «Bandi attivi» per gestire domande e graduatorie."
                    : `Dopo l'approvazione definitiva del CdA (passaggio ${FASE_APPROVAZIONE_DEFINITIVA}) il bando passa in «Bandi attivi».`}
                </p>
                {write && (
                  <div className="flex gap-2 flex-wrap">
                    <button className="btn-primary text-xs" onClick={() => setConfirmCreaBando(true)} disabled={busy}>
                      <Plus size={14} aria-hidden="true" /> Crea bando
                    </button>
                    <button className="btn-secondary text-xs" onClick={apriCollega}>
                      <Link2 size={14} aria-hidden="true" /> Collega bando esistente
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="card p-4 space-y-2 text-sm" aria-labelledby="titolo-dati-schema">
            <h2 id="titolo-dati-schema" className="font-semibold text-gray-900">Dati dello schema</h2>
            <dl className="space-y-1.5">
              <Riga label="Dotazione" value={formatCurrency(s.dotazione_finanziaria)} />
              <Riga label="Regime de minimis" value={s.de_minimis ? "Sì" : "No"} />
              <Riga label="Creato il" value={formatDate(s.created_at)} />
            </dl>
            {s.descrizione && <p className="text-gray-700 whitespace-pre-wrap pt-2 border-t">{s.descrizione}</p>}
            {s.note && <p className="text-gray-700 whitespace-pre-wrap pt-2 border-t">{s.note}</p>}
          </section>

          <section className="card p-4" aria-label="Documenti generali dello schema">
            <AttachmentPanel bucket={BUCKET_DOCUMENTI} entityType={`schemi_bando/${s.id}`} entityId="generale" readonly={!write} />
          </section>
        </div>
      </div>

      {/* Aggiornamento di un passaggio */}
      <Modal open={!!faseAperta} onClose={() => { setFaseAperta(null); setFormFase(null); }}
        title={faseAperta ? `Passaggio ${faseAperta.numero} — ${faseAperta.titolo}` : ""} size="lg">
        {faseAperta && formFase && (
          <div className="space-y-5">
            <p className="text-sm text-gray-700">{GUIDA_FASI_SCHEMA[faseAperta.numero]?.cosa}</p>
            <form onSubmit={handleSalvaFase} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="fase-stato" className="label">Stato</label>
                  <select id="fase-stato" className="input" value={formFase.stato}
                    onChange={(e) => {
                      const stato = e.target.value as StatoFaseSchema;
                      setFormFase({ ...formFase, stato, data_completamento: stato === "completata" && !formFase.data_completamento ? oggiISO() : formFase.data_completamento });
                    }}>
                    {(Object.keys(STATO_FASE_LABELS) as StatoFaseSchema[]).map((k) => <option key={k} value={k}>{STATO_FASE_LABELS[k]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="fase-avvio" className="label">Avviato il</label>
                  <input id="fase-avvio" type="date" className="input" value={formFase.data_avvio}
                    onChange={(e) => setFormFase({ ...formFase, data_avvio: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="fase-fine" className="label">Completato il{formFase.stato === "completata" ? " *" : ""}</label>
                  <input id="fase-fine" type="date" className="input" value={formFase.data_completamento}
                    required={formFase.stato === "completata"} disabled={formFase.stato !== "completata"}
                    onChange={(e) => setFormFase({ ...formFase, data_completamento: e.target.value })} />
                </div>
              </div>
              <div>
                <label htmlFor="fase-rif" className="label">{GUIDA_FASI_SCHEMA[faseAperta.numero]?.riferimento ?? "Riferimento"}</label>
                <input id="fase-rif" className="input" value={formFase.riferimento}
                  onChange={(e) => setFormFase({ ...formFase, riferimento: e.target.value })} />
              </div>
              <div>
                <label htmlFor="fase-note" className="label">Note (osservazioni della Regione, solleciti…)</label>
                <textarea id="fase-note" className="input" rows={3} value={formFase.note}
                  onChange={(e) => setFormFase({ ...formFase, note: e.target.value })} />
              </div>
              <div className="flex gap-3">
                <button type="submit" className="btn-primary flex-1 justify-center" disabled={busy}>
                  {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />} Salva passaggio
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setFaseAperta(null); setFormFase(null); }}>Annulla</button>
              </div>
            </form>
            <div className="border-t pt-4">
              <p className="text-xs text-gray-600 mb-2">Allega qui i documenti del passaggio (bozza, e-mail, PEC, verbale, atto regionale, ricevute SIAN…).</p>
              <AttachmentPanel bucket={BUCKET_DOCUMENTI} entityType={`schemi_bando/${s.id}`} entityId={`fase-${faseAperta.numero}`} readonly={!write} />
            </div>
          </div>
        )}
      </Modal>

      {/* Modifica dati dello schema */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Modifica schema di bando" size="lg">
        <form onSubmit={handleSalvaSchema} className="space-y-4">
          <div>
            <label htmlFor="ms-titolo" className="label">Titolo del bando *</label>
            <input id="ms-titolo" className="input" required value={formSchema.titolo ?? ""} onChange={(e) => setFormSchema({ ...formSchema, titolo: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="ms-intervento" className="label">Intervento *</label>
              <input id="ms-intervento" className="input" required value={formSchema.intervento ?? ""} onChange={(e) => setFormSchema({ ...formSchema, intervento: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label htmlFor="ms-sotto" className="label">Sottointervento</label>
              <input id="ms-sotto" className="input" value={formSchema.sottointervento ?? ""} onChange={(e) => setFormSchema({ ...formSchema, sottointervento: e.target.value })} />
            </div>
            <div>
              <label htmlFor="ms-azione" className="label">Azione</label>
              <input id="ms-azione" className="input" value={formSchema.azione ?? ""} onChange={(e) => setFormSchema({ ...formSchema, azione: e.target.value })} />
            </div>
          </div>
          <div>
            <label htmlFor="ms-descrizione" className="label">Descrizione</label>
            <textarea id="ms-descrizione" className="input" rows={3} value={formSchema.descrizione ?? ""} onChange={(e) => setFormSchema({ ...formSchema, descrizione: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ms-dotazione" className="label">Dotazione finanziaria (€)</label>
              <input id="ms-dotazione" className="input" type="number" step="0.01" min="0" value={formSchema.dotazione_finanziaria ?? 0}
                onChange={(e) => setFormSchema({ ...formSchema, dotazione_finanziaria: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label htmlFor="ms-stato" className="label">Stato</label>
              <select id="ms-stato" className="input" value={formSchema.stato ?? s.stato} onChange={(e) => setFormSchema({ ...formSchema, stato: e.target.value as StatoSchemaBando })}>
                {(Object.keys(STATO_SCHEMA_LABELS) as StatoSchemaBando[]).map((k) => <option key={k} value={k}>{STATO_SCHEMA_LABELS[k]}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!formSchema.de_minimis} onChange={(e) => setFormSchema({ ...formSchema, de_minimis: e.target.checked })} />
            <span>Contributi in regime <strong>de minimis</strong> (passaggio 9: inserimento in RNA)</span>
          </label>
          <div>
            <label htmlFor="ms-note" className="label">Note</label>
            <textarea id="ms-note" className="input" rows={2} value={formSchema.note ?? ""} onChange={(e) => setFormSchema({ ...formSchema, note: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1 justify-center" disabled={busy}>Salva</button>
            <button type="button" className="btn-secondary" onClick={() => setShowEdit(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      {/* Collegamento a un bando già presente */}
      <Modal open={showCollega} onClose={() => setShowCollega(false)} title="Collega un bando esistente">
        <form onSubmit={collegaBando} className="space-y-4">
          <div>
            <label htmlFor="collega-bando" className="label">Bando in «Bandi attivi»</label>
            <select id="collega-bando" className="input" required value={bandoScelto} onChange={(e) => setBandoScelto(e.target.value)}>
              <option value="">Seleziona…</option>
              {bandiDisponibili.map((b) => <option key={b.id} value={b.id}>{[b.numero && `n. ${b.numero}`, b.titolo].filter(Boolean).join(" — ")}</option>)}
            </select>
            {bandiDisponibili.length === 0 && <p className="text-xs text-gray-600 mt-1">Non ci sono bandi: usa «Crea bando».</p>}
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn-primary flex-1 justify-center" disabled={!bandoScelto}>Collega</button>
            <button type="button" className="btn-secondary" onClick={() => setShowCollega(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmCreaBando}
        title="Creare il bando definitivo?"
        message={`Verrà creato in «Bandi attivi» un bando in stato bozza con titolo, intervento e dotazione di questo schema.${faseDefinitiva?.stato !== "completata" ? " Attenzione: l'approvazione definitiva del CdA (passaggio 5) non risulta ancora completata." : ""}`}
        confirmLabel="Crea bando"
        onConfirm={creaBando}
        onCancel={() => setConfirmCreaBando(false)}
      />
      <ConfirmDialog
        open={confirmElimina}
        danger
        title="Eliminare lo schema di bando?"
        message="Verranno eliminati anche i passaggi dell'iter e i documenti allegati. Il bando definitivo eventualmente collegato non viene toccato. L'operazione non è reversibile."
        confirmLabel="Elimina"
        onConfirm={eliminaSchema}
        onCancel={() => setConfirmElimina(false)}
      />
    </div>
  );
}

function Riga({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-600">{label}</dt>
      <dd className="text-gray-900 text-right">{value}</dd>
    </div>
  );
}
