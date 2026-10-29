// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Scheda del mandato: i dati estratti dal documento si controllano e si correggono qui
 * (passaggio obbligatorio), poi si conferma e si scarica il Word.
 * Stati: bozza → verificato → firmato → pagato (+ annullato, che conserva il numero).
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import clsx from "clsx";
import {
  ArrowLeft, Loader2, Save, FileDown, CheckCircle2, Plus, Trash2, AlertTriangle, Upload, RotateCcw,
  PenLine, Banknote, Ban, RefreshCw, Link2,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { oggiISO } from "../../lib/scadenze";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { importoInLettere, r2 } from "../../lib/mandati/importoInLettere";
import { ibanValido, formattaIban } from "../../lib/mandati/controlli";
import type { SchedaMandato, VoceMandato } from "../../lib/mandati/tipi";
import {
  STATO_MANDATO_COLORS, STATO_MANDATO_LABELS, archiviaEVerifica, caricaEnte, caricaImpostazioni, generaWord, isFileFattura,
  mandatiGiaEmessi, nomeFileMandato, numeroStampa, scaricaDaArchivio, scaricaFile, schedaDaGiustificativo,
  schedaDaScadenza, schedaVuota, schedeDaFileFattura, sommaVoci, uniscinote,
} from "../../lib/mandati/servizio";
import type { Giustificativo, ImpostazioniMandati, Mandato, ScadenzaPagamento, StatoMandato } from "../../types";

type Doppione = Pick<Mandato, "id" | "numero" | "anno" | "stato" | "beneficiario_nome">;
type Conferma = null | "verifica" | "doppio" | "annulla" | "elimina" | "bozza";

export default function MandatoScheda() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const gal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);
  const nuovo = !id;

  const [imp, setImp] = useState<ImpostazioniMandati | null>(null);
  const [mandato, setMandato] = useState<Mandato | null>(null);
  const [scheda, setScheda] = useState<SchedaMandato | null>(null);
  const [alternative, setAlternative] = useState<SchedaMandato[]>([]);
  const [dataOrdine, setDataOrdine] = useState(oggiISO());
  const [numeroManuale, setNumeroManuale] = useState(false);
  const [numero, setNumero] = useState("");
  const [proposto, setProposto] = useState<number | null>(null);
  const [scadenzaId, setScadenzaId] = useState<string | null>(null);
  const [giustificativoId, setGiustificativoId] = useState<string | null>(null);
  const [origine, setOrigine] = useState("");
  const [doppioni, setDoppioni] = useState<Doppione[]>([]);
  const [delibere, setDelibere] = useState<string[]>([]);
  const [collegati, setCollegati] = useState<Pick<Mandato, "id" | "numero" | "anno" | "modalita" | "stato">[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [conferma, setConferma] = useState<Conferma>(null);

  const modificabile = write && (nuovo || mandato?.stato === "bozza");
  const anno = Number(dataOrdine.slice(0, 4));

  // ─── Caricamento ───────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const i = await caricaImpostazioni();
        setImp(i);
        caricaDelibere();
        if (id) await caricaMandato(id);
        else await preparaNuovo(i);
      } catch (e) {
        toast.error(messaggioErrore(e, "Impossibile preparare il mandato"));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!nuovo || numeroManuale || !anno) return;
    supabase.rpc("gal_mandati_numero_proposto", { p_anno: anno }).then(({ data, error }) => {
      if (error) console.error(error);
      else setProposto(typeof data === "number" ? data : null);
    });
  }, [anno, nuovo, numeroManuale]);

  async function caricaDelibere() {
    const { data, error } = await supabase.from("gal_delibere").select("numero, anno, data_delibera, oggetto").order("data_delibera", { ascending: false }).limit(200);
    if (error) { console.error(error); return; }
    setDelibere((data ?? []).map((d: { numero: string | null; anno: number | null; data_delibera: string | null; oggetto: string | null }) =>
      [`Delibera CdA n. ${d.numero ?? "?"}${d.anno ? `/${d.anno}` : ""}`, d.data_delibera && `del ${formatDate(d.data_delibera)}`, d.oggetto && `- ${d.oggetto.slice(0, 80)}`].filter(Boolean).join(" ")));
  }

  async function caricaMandato(mid: string) {
    const { data, error } = await supabase.from("gal_mandati").select("*").eq("id", mid).single();
    if (error || !data) { toast.error("Mandato non trovato"); navigate("/mandati"); return; }
    const m = data as Mandato;
    setMandato(m);
    setScheda({ ...m.scheda, note: m.scheda.note ?? [], voci: m.scheda.voci ?? [] });
    setDataOrdine(m.data_ordine);
    setNumero(String(m.numero));
    setNumeroManuale(m.numero_manuale);
    setScadenzaId(m.scadenza_id);
    setGiustificativoId(m.giustificativo_id);
    // Mandati collegati nei due sensi (es. netto del compenso ⇄ relativo F24)
    const filtro = [`mandato_collegato_id.eq.${m.id}`, m.mandato_collegato_id && `id.eq.${m.mandato_collegato_id}`].filter(Boolean).join(",");
    const { data: coll, error: errColl } = await supabase.from("gal_mandati").select("id, numero, anno, modalita, stato").or(filtro);
    if (errColl) console.error(errColl);
    setCollegati((coll ?? []) as Pick<Mandato, "id" | "numero" | "anno" | "modalita" | "stato">[]);
  }

  async function ibanFornitore(fornitoreId: string | null): Promise<string | undefined> {
    if (!fornitoreId) return undefined;
    const { data, error } = await supabase.from("gal_fornitori").select("iban").eq("id", fornitoreId).maybeSingle();
    if (error) console.error(error);
    return (data as { iban: string | null } | null)?.iban ?? undefined;
  }

  /** Legge una fattura XML/p7m dall'archivio; se non riesce torna null e si usano i dati registrati */
  async function schedeDaArchivio(path: string, i: ImpostazioniMandati | null): Promise<SchedaMandato[] | null> {
    try {
      return schedeDaFileFattura(await scaricaDaArchivio(path), i);
    } catch (e) {
      console.error(e);
      toast.warning("Non è stato possibile leggere la fattura XML: uso i dati registrati, da controllare.");
      return null;
    }
  }

  async function preparaNuovo(i: ImpostazioniMandati | null) {
    const scId = params.get("scadenza");
    const gId = params.get("giustificativo");
    let s: SchedaMandato = schedaVuota(i);
    let alt: SchedaMandato[] = [];

    if (scId) {
      const { data, error } = await supabase.from("gal_scadenze_pagamento").select("*").eq("id", scId).single();
      if (error || !data) throw error ?? new Error("Pagamento non trovato");
      const sc = data as ScadenzaPagamento;
      setScadenzaId(sc.id);
      setGiustificativoId(sc.giustificativo_id);
      setOrigine(`Scadenzario: ${sc.beneficiario} — ${sc.descrizione}`);
      const daXml = sc.fattura_path && isFileFattura(sc.fattura_nome ?? sc.fattura_path) ? await schedeDaArchivio(sc.fattura_path, i) : null;
      if (daXml?.length) { alt = daXml; s = daXml[0]; } else s = schedaDaScadenza(sc, i);
      if (!s.beneficiario_iban) s.beneficiario_iban = sc.beneficiario_iban ?? (await ibanFornitore(sc.fornitore_id));
    } else if (gId) {
      const { data, error } = await supabase.from("gal_giustificativi").select("*").eq("id", gId).single();
      if (error || !data) throw error ?? new Error("Giustificativo non trovato");
      const g = data as Giustificativo;
      setGiustificativoId(g.id);
      setOrigine(`Giustificativo: n. ${g.numero_doc} del ${formatDate(g.data_doc)} — ${g.fornitore_denominazione ?? ""}`);
      const [docs, scad] = await Promise.all([
        supabase.from("gal_documenti_giustificativo").select("storage_path, nome_file, tipo").eq("giustificativo_id", g.id),
        supabase.from("gal_scadenze_pagamento").select("id").eq("giustificativo_id", g.id).neq("stato", "annullata").limit(1).maybeSingle(),
      ]);
      if (docs.error) console.error(docs.error);
      if (scad.error) console.error(scad.error);
      if (scad.data) setScadenzaId((scad.data as { id: string }).id);
      const xml = (docs.data ?? []).find((d: { tipo: string | null; nome_file: string | null; storage_path: string | null }) => d.storage_path && (d.tipo === "xml" || isFileFattura(d.nome_file)));
      const daXml = xml?.storage_path ? await schedeDaArchivio(xml.storage_path, i) : null;
      if (daXml?.length) { alt = daXml; s = daXml[0]; } else s = schedaDaGiustificativo(g, i);
      if (!s.beneficiario_iban) s.beneficiario_iban = await ibanFornitore(g.fornitore_id);
    }

    setAlternative(alt);
    const conNote = uniscinote(s, dataOrdine);
    setScheda(conNote);
    if (scId || gId) {
      const d = await mandatiGiaEmessi({ scadenzaId: scId, giustificativoId: gId, piva: conNote.beneficiario_piva, numeroDocumento: conNote.numero_documento });
      setDoppioni(d);
    }
  }

  if (loading || !scheda) {
    return <div className="flex items-center justify-center gap-2 text-gray-500 py-20" role="status"><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Preparazione del mandato…</div>;
  }

  const s = scheda;
  const somma = sommaVoci(s.voci);
  const differenza = s.voci.some((v) => v.voce.toLowerCase().startsWith("totale documento")) ? 0 : r2(somma - s.netto);
  const stato: StatoMandato = mandato?.stato ?? "bozza";
  const set = (patch: Partial<SchedaMandato>) => setScheda({ ...s, ...patch });
  const setVoce = (i: number, patch: Partial<VoceMandato>) => set({ voci: s.voci.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  // ─── Azioni ────────────────────────────────────────────────────
  async function caricaFileXml(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const schede = schedeDaFileFattura(new Uint8Array(await file.arrayBuffer()), imp);
      setAlternative(schede);
      const nuova = uniscinote({ ...schede[0], beneficiario_iban: schede[0].beneficiario_iban ?? s.beneficiario_iban }, dataOrdine);
      setScheda(nuova);
      setOrigine(`File: ${file.name}`);
      setDoppioni(await mandatiGiaEmessi({ piva: nuova.beneficiario_piva, numeroDocumento: nuova.numero_documento, escludiId: mandato?.id }));
      toast.success(schede.length > 1 ? `Fattura letta: contiene ${schede.length} lotti, scegli quello da pagare` : "Fattura letta: controlla i dati");
    } catch (err) {
      toast.error(messaggioErrore(err, "Il file non è una fattura elettronica leggibile"));
    }
  }

  function ricontrolla() {
    set(uniscinote(s, dataOrdine));
    toast.info("Controlli eseguiti: le nuove segnalazioni sono state aggiunte alle note");
  }

  function validaPerSalvataggio(): boolean {
    if (!s.beneficiario_nome.trim()) { toast.error("Indica il beneficiario"); return false; }
    if (!s.causale.trim()) { toast.error("Indica la causale"); return false; }
    if (!(s.netto > 0)) { toast.error("L'importo da pagare deve essere maggiore di zero"); return false; }
    if (numeroManuale && !(parseInt(numero, 10) > 0)) { toast.error("Il numero del mandato deve essere un intero positivo"); return false; }
    return true;
  }

  /** Salva la scheda; restituisce l'id del mandato o null */
  async function salva(saltaControlloDoppi = false, naviga = true): Promise<string | null> {
    if (!validaPerSalvataggio() || !gal || !user) return null;
    if (!saltaControlloDoppi) {
      try {
        const d = await mandatiGiaEmessi({ scadenzaId, giustificativoId, piva: s.beneficiario_piva, numeroDocumento: s.numero_documento, escludiId: mandato?.id });
        if (d.length) { setDoppioni(d); setConferma("doppio"); return null; }
      } catch (e) { console.error(e); }
    }
    const pulita: SchedaMandato = {
      ...s,
      beneficiario_iban: s.beneficiario_iban ? s.beneficiario_iban.replace(/\s+/g, "").toUpperCase() : undefined,
      voci: s.voci.filter((v) => v.voce.trim()).map((v) => ({ ...v, importo: r2(Number(v.importo) || 0) })),
      note: s.note.map((n) => n.trim()).filter(Boolean),
      netto: r2(s.netto),
    };
    const n = parseInt(numero, 10);
    const cambioAnno = !!mandato && mandato.anno !== anno;
    const payload: Record<string, unknown> = {
      anno, data_ordine: dataOrdine, numero_manuale: numeroManuale,
      tipo_documento: pulita.tipo_documento, modalita: pulita.modalita === "f24" ? "f24" : "bonifico",
      scheda: pulita, netto: pulita.netto, beneficiario_nome: pulita.beneficiario_nome.trim(),
      beneficiario_piva: pulita.beneficiario_piva || null, beneficiario_iban: pulita.beneficiario_iban || null,
      numero_documento: pulita.numero_documento || null, cup: pulita.cup || null,
      scadenza_id: scadenzaId, giustificativo_id: giustificativoId,
    };
    if (numeroManuale) payload.numero = n;
    else if (cambioAnno) payload.numero = null; // nuovo anno: numerazione automatica dell'anno giusto

    if (numeroManuale && (!mandato || mandato.numero !== n || cambioAnno)) {
      const { data: prox } = await supabase.rpc("gal_mandati_numero_proposto", { p_anno: anno });
      if (typeof prox === "number" && n > prox) toast.warning(`Con il n. ${n} restano saltati i numeri da ${prox} a ${n - 1} del ${anno}.`);
    }

    setBusy(true);
    const res = mandato
      ? await supabase.from("gal_mandati").update(payload).eq("id", mandato.id).select("*").single()
      : await supabase.from("gal_mandati").insert(payload).select("*").single();
    setBusy(false);
    if (res.error || !res.data) {
      const codice = (res.error as { code?: string } | null)?.code;
      if (codice === "23505") toast.error(numeroManuale ? `Il numero ${n}/${anno} è già usato da un altro mandato` : "Numero già usato: riprova");
      else toast.error(messaggioErrore(res.error, "Mandato non salvato"));
      return null;
    }
    const m = res.data as Mandato;
    await logAudit({ galId: gal.id, userId: user.id, username: user.nome_completo, azione: mandato ? "UPDATE" : "CREATE", entita: "mandato", entitaId: m.id, descrizione: `Mandato ${numeroStampa(m)} — ${m.beneficiario_nome} ${formatCurrency(m.netto)}` });
    setMandato(m);
    setScheda(m.scheda);
    setNumero(String(m.numero));
    setDoppioni([]);
    if (nuovo && naviga) {
      toast.success(`Mandato n. ${numeroStampa(m)} salvato in bozza`);
      navigate(`/mandati/${m.id}`, { replace: true });
    } else if (naviga) toast.success("Mandato salvato");
    return m.id;
  }

  /** mid: serve subito dopo il primo salvataggio, quando lo stato React non è ancora aggiornato */
  async function cambiaStato(nuovoStato: StatoMandato, patch: Partial<Mandato>, messaggio: string, mid = mandato?.id) {
    if (!mid || !gal || !user) return false;
    setBusy(true);
    const { data, error } = await supabase.from("gal_mandati").update({ stato: nuovoStato, ...patch }).eq("id", mid).select("*").single();
    setBusy(false);
    if (error || !data) { toast.error(messaggioErrore(error, "Stato non aggiornato")); return false; }
    const m = data as Mandato;
    await logAudit({ galId: gal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "mandato", entitaId: mid, descrizione: `Mandato ${numeroStampa(m)}: ${STATO_MANDATO_LABELS[nuovoStato]}` });
    setMandato(m);
    toast.success(messaggio);
    return true;
  }

  /** Conferma esplicita: salva, toglie "BOZZA", archivia il Word e lo collega al giustificativo */
  async function verifica() {
    setConferma(null);
    if (!gal || !user) return;
    const mid = await salva(true, false);
    if (!mid) return;
    const { data: fresco, error: errLettura } = await supabase.from("gal_mandati").select("*").eq("id", mid).single();
    if (errLettura || !fresco) { toast.error(messaggioErrore(errLettura, "Mandato non trovato")); return; }
    setBusy(true);
    try {
      const { mandato: m, word, avviso } = await archiviaEVerifica(fresco as Mandato, await caricaEnte(gal, imp), user.nome_completo);
      await logAudit({ galId: gal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "mandato", entitaId: m.id, descrizione: `Mandato ${numeroStampa(m)}: ${STATO_MANDATO_LABELS.verificato}` });
      setMandato(m);
      toast.success(`Mandato ${numeroStampa(m)} verificato e archiviato`);
      if (avviso) toast.warning(avviso);
      scaricaFile(word, nomeFileMandato(m));
      if (nuovo) navigate(`/mandati/${m.id}`, { replace: true });
    } catch (e) {
      toast.error(messaggioErrore(e, "Word non archiviato: il mandato resta in bozza"));
    } finally {
      setBusy(false);
    }
  }

  async function scaricaWord() {
    if (!gal) return;
    setBusy(true);
    try {
      const m = mandato
        ? { ...mandato, scheda: modificabile ? s : mandato.scheda, data_ordine: modificabile ? dataOrdine : mandato.data_ordine }
        : { scheda: s, numero: parseInt(numero, 10) || proposto || 0, anno, data_ordine: dataOrdine, stato: "bozza" as StatoMandato, beneficiario_nome: s.beneficiario_nome || "mandato" };
      scaricaFile(await generaWord(m, await caricaEnte(gal, imp)), nomeFileMandato(m));
    } catch (e) {
      toast.error(messaggioErrore(e, "Impossibile generare il Word"));
    } finally {
      setBusy(false);
    }
  }

  async function elimina() {
    setConferma(null);
    if (!mandato || !gal || !user) return;
    const { error } = await supabase.from("gal_mandati").delete().eq("id", mandato.id);
    if (error) { toast.error(messaggioErrore(error, "Mandato non eliminato")); return; }
    await logAudit({ galId: gal.id, userId: user.id, username: user.nome_completo, azione: "DELETE", entita: "mandato", entitaId: mandato.id, descrizione: `Bozza mandato ${numeroStampa(mandato)} eliminata` });
    toast.success("Bozza eliminata");
    navigate("/mandati");
  }

  // ─── Interfaccia ───────────────────────────────────────────────
  const campo = (k: keyof SchedaMandato, label: string, opz: { obbl?: boolean; area?: boolean; lista?: string; largo?: boolean; aiuto?: string } = {}) => (
    <div className={opz.largo ? "md:col-span-2" : ""}>
      <label htmlFor={`m-${k}`} className="label">{label}{opz.obbl ? " *" : ""}</label>
      {opz.area ? (
        <textarea id={`m-${k}`} className="input" rows={3} value={String(s[k] ?? "")} disabled={!modificabile} required={opz.obbl}
          onChange={(e) => set({ [k]: e.target.value } as Partial<SchedaMandato>)} />
      ) : (
        <input id={`m-${k}`} className="input" value={String(s[k] ?? "")} disabled={!modificabile} required={opz.obbl} list={opz.lista}
          aria-describedby={opz.aiuto ? `m-${k}-aiuto` : undefined}
          onChange={(e) => set({ [k]: e.target.value || (opz.obbl ? "" : undefined) } as Partial<SchedaMandato>)} />
      )}
      {opz.aiuto && <p id={`m-${k}-aiuto`} className="text-xs text-gray-600 mt-1">{opz.aiuto}</p>}
    </div>
  );

  const ibanOk = !s.beneficiario_iban || ibanValido(s.beneficiario_iban);

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Intestazione */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <button className="btn-ghost p-1.5 mt-0.5" onClick={() => navigate("/mandati")} aria-label="Torna ai mandati" title="Torna ai mandati"><ArrowLeft size={18} aria-hidden="true" /></button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {mandato ? `Mandato n. ${numeroStampa(mandato)}` : "Nuovo mandato di pagamento"}
            </h1>
            <div className="flex gap-2 mt-1 flex-wrap items-center">
              <span className={clsx("badge", STATO_MANDATO_COLORS[stato])}>{STATO_MANDATO_LABELS[stato]}</span>
              {mandato?.verificato_da && <span className="text-xs text-gray-600">Verificato da {mandato.verificato_da} il {formatDate(mandato.verificato_il)}</span>}
              {origine && <span className="text-xs text-gray-600">Da {origine}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={scaricaWord} disabled={busy}><FileDown size={16} aria-hidden="true" /> Scarica Word</button>
          {modificabile && (
            <>
              <button className="btn-secondary" onClick={() => salva()} disabled={busy}>
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Salva bozza
              </button>
              <button className="btn-primary" onClick={() => validaPerSalvataggio() && setConferma("verifica")} disabled={busy}>
                <CheckCircle2 size={16} aria-hidden="true" /> Conferma (verificato)
              </button>
            </>
          )}
          {write && mandato && stato === "verificato" && (
            <>
              <button className="btn-secondary" onClick={() => setConferma("bozza")} disabled={busy}><RotateCcw size={16} aria-hidden="true" /> Riporta in bozza</button>
              <button className="btn-primary" onClick={() => cambiaStato("firmato", {}, "Mandato segnato come firmato")} disabled={busy}><PenLine size={16} aria-hidden="true" /> Segna firmato</button>
            </>
          )}
          {write && mandato && stato === "firmato" && (
            <button className="btn-primary" onClick={() => cambiaStato("pagato", {}, "Mandato segnato come pagato")} disabled={busy}><Banknote size={16} aria-hidden="true" /> Segna pagato</button>
          )}
          {write && mandato && stato !== "annullato" && stato !== "bozza" && (
            <button className="btn-ghost text-red-700" onClick={() => setConferma("annulla")} disabled={busy}><Ban size={16} aria-hidden="true" /> Annulla</button>
          )}
          {admin && mandato && stato === "bozza" && (
            <button className="btn-ghost text-red-700" onClick={() => setConferma("elimina")} aria-label="Elimina bozza" title="Elimina bozza"><Trash2 size={16} aria-hidden="true" /></button>
          )}
        </div>
      </div>

      {doppioni.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex gap-2" role="alert">
          <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
          <div>
            <strong>Attenzione, possibile doppio pagamento:</strong> per questo documento esiste già{" "}
            {doppioni.map((d, i) => (
              <span key={d.id}>{i > 0 && ", "}<Link to={`/mandati/${d.id}`} className="underline">il mandato n. {numeroStampa(d)}</Link> ({STATO_MANDATO_LABELS[d.stato].toLowerCase()})</span>
            ))}.
          </div>
        </div>
      )}

      {alternative.length > 1 && modificabile && (
        <div className="card p-3 flex items-center gap-3 flex-wrap text-sm">
          <label htmlFor="m-lotto" className="font-medium">La fattura contiene {alternative.length} lotti: quale pagare?</label>
          <select id="m-lotto" className="input w-auto" onChange={(e) => setScheda(uniscinote(alternative[Number(e.target.value)], dataOrdine))}>
            {alternative.map((a, i) => <option key={i} value={i}>Lotto {i + 1} — {formatCurrency(a.netto)}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Beneficiario */}
          <section className="card p-5 space-y-4" aria-labelledby="t-benef">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 id="t-benef" className="font-semibold text-gray-900">Beneficiario</h2>
              {modificabile && (
                <label className="btn-ghost text-sm cursor-pointer">
                  <Upload size={14} aria-hidden="true" /> Leggi da fattura XML / p7m
                  <input type="file" accept=".xml,.p7m" className="sr-only" onChange={caricaFileXml} />
                </label>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {campo("beneficiario_nome", "Nome o ragione sociale", { obbl: true, largo: true })}
              {campo("beneficiario_cf", "Codice fiscale")}
              {campo("beneficiario_piva", "Partita IVA")}
              {campo("beneficiario_indirizzo", "Indirizzo", { largo: true })}
              <div>
                <label htmlFor="m-modalita" className="label">Modalità di pagamento</label>
                <select id="m-modalita" className="input" value={s.modalita ?? "bonifico"} disabled={!modificabile}
                  onChange={(e) => set({ modalita: e.target.value as "bonifico" | "f24" })}>
                  <option value="bonifico">Bonifico</option>
                  <option value="f24">Modello F24</option>
                </select>
              </div>
              {campo("beneficiario_banca", "Banca del beneficiario")}
              {s.modalita !== "f24" && (
                <div className="md:col-span-2">
                  <label htmlFor="m-iban" className="label">IBAN del beneficiario</label>
                  <input id="m-iban" className={clsx("input font-mono", !ibanOk && "border-red-500")} value={s.beneficiario_iban ?? ""} disabled={!modificabile}
                    aria-invalid={!ibanOk} aria-describedby="m-iban-esito"
                    onChange={(e) => set({ beneficiario_iban: e.target.value.toUpperCase() || undefined })} />
                  <p id="m-iban-esito" className={clsx("text-xs mt-1", ibanOk ? "text-gray-600" : "text-red-700 font-medium")}>
                    {!s.beneficiario_iban ? "IBAN mancante: nel mandato comparirà il segnaposto giallo." : ibanOk ? `IBAN valido: ${formattaIban(s.beneficiario_iban)}` : "IBAN non valido: controlla le cifre."}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Importi */}
          <section className="card p-5 space-y-4" aria-labelledby="t-importi">
            <h2 id="t-importi" className="font-semibold text-gray-900">Importi</h2>
            {campo("titolo_importi", "Titolo della tabella importi", { largo: true })}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Voci degli importi del mandato</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="table-header text-left">Descrizione</th>
                    <th scope="col" className="table-header text-right w-36">Importo (€)</th>
                    <th scope="col" className="table-header text-center w-24">Totale</th>
                    {modificabile && <th scope="col" className="table-header w-10"><span className="sr-only">Azioni</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {s.voci.map((v, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1 pr-2">
                        <input className={clsx("input", v.grassetto && "font-semibold")} value={v.voce} disabled={!modificabile} aria-label={`Descrizione voce ${i + 1}`}
                          onChange={(e) => setVoce(i, { voce: e.target.value })} />
                      </td>
                      <td className="py-1 pr-2">
                        <input className="input text-right" type="number" step="0.01" value={v.importo} disabled={!modificabile} aria-label={`Importo voce ${i + 1}`}
                          onChange={(e) => setVoce(i, { importo: parseFloat(e.target.value) || 0 })} />
                      </td>
                      <td className="py-1 text-center">
                        <input type="checkbox" className="h-4 w-4" checked={!!v.grassetto} disabled={!modificabile} aria-label={`Voce ${i + 1} è una riga di totale (grassetto)`}
                          onChange={(e) => setVoce(i, { grassetto: e.target.checked })} />
                      </td>
                      {modificabile && (
                        <td className="py-1">
                          <button className="btn-ghost p-1 text-red-600" onClick={() => set({ voci: s.voci.filter((_, j) => j !== i) })} aria-label={`Elimina voce ${i + 1}`} title="Elimina voce">
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {modificabile && (
              <button className="btn-ghost text-sm" onClick={() => set({ voci: [...s.voci, { voce: "", importo: 0 }] })}><Plus size={14} aria-hidden="true" /> Aggiungi voce</button>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start pt-2 border-t">
              <div>
                <label htmlFor="m-netto" className="label">Importo da pagare (netto) *</label>
                <input id="m-netto" className="input text-right font-semibold" type="number" step="0.01" min="0" value={s.netto} disabled={!modificabile}
                  aria-describedby="m-netto-info" onChange={(e) => set({ netto: parseFloat(e.target.value) || 0 })} />
                <div id="m-netto-info" className="text-xs mt-1 space-y-1">
                  {differenza !== 0 && (
                    <p className="text-red-700 font-medium">
                      La somma delle voci ({formatCurrency(somma)}) è diversa dal netto.{" "}
                      {modificabile && <button className="underline" onClick={() => set({ netto: somma })}>Usa la somma</button>}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <p className="label">Importo in lettere (calcolato)</p>
                <p className="text-sm font-medium text-gray-900 py-2" aria-live="polite">{s.netto > 0 ? importoInLettere(s.netto) : "—"}</p>
              </div>
            </div>
          </section>

          {/* Causale e riferimenti */}
          <section className="card p-5 space-y-4" aria-labelledby="t-causale">
            <h2 id="t-causale" className="font-semibold text-gray-900">Causale e riferimenti</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {campo("causale", "Causale", { obbl: true, area: true, largo: true })}
              {campo("numero_documento", "Numero documento")}
              <div>
                <label htmlFor="m-data-doc" className="label">Data documento</label>
                <input id="m-data-doc" type="date" className="input" value={s.data_documento ?? ""} disabled={!modificabile}
                  onChange={(e) => set({ data_documento: e.target.value || undefined })} />
              </div>
              {campo("cup", "CUP")}
              {campo("cig", "CIG")}
              {campo("operazione", "Operazione")}
              {campo("misura", "Misura")}
              {campo("codice_progetto", "Codice progetto", { largo: true, aiuto: `Se vuoto: «Provvedimento Aiuti n. ${imp?.pratica ?? "…"}»` })}
              {campo("delibera_ammissione", "Delibera CdA di ammissione della spesa", { largo: true, lista: "elenco-delibere" })}
              {campo("delibera_autorizzazione", "Delibera CdA di autorizzazione al pagamento", { largo: true, lista: "elenco-delibere" })}
              <datalist id="elenco-delibere">{delibere.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
          </section>
        </div>

        {/* Colonna laterale */}
        <div className="space-y-5">
          <section className="card p-5 space-y-3" aria-labelledby="t-numero">
            <h2 id="t-numero" className="font-semibold text-gray-900">Numero e data</h2>
            <div>
              <label htmlFor="m-data" className="label">Data dell'ordine *</label>
              <input id="m-data" type="date" className="input" value={dataOrdine} disabled={!modificabile} required
                onChange={(e) => setDataOrdine(e.target.value || oggiISO())} />
            </div>
            <div>
              <p className="label">Numero d'ordine</p>
              {numeroManuale ? (
                <div className="flex items-center gap-2">
                  <label htmlFor="m-numero" className="sr-only">Numero scelto a mano</label>
                  <input id="m-numero" type="number" min={1} className="input w-28" value={numero} disabled={!modificabile} onChange={(e) => setNumero(e.target.value)} />
                  <span className="text-sm text-gray-700">/ {anno}</span>
                </div>
              ) : (
                <p className="text-lg font-semibold text-gray-900">
                  {mandato && mandato.anno === anno ? numeroStampa(mandato) : proposto ? `${proposto}/${anno}` : "—"}
                  {!mandato && <span className="block text-xs font-normal text-gray-600">Proposto: viene assegnato al salvataggio</span>}
                </p>
              )}
              {modificabile && (
                <label className="flex items-center gap-2 text-sm mt-2">
                  <input type="checkbox" className="h-4 w-4" checked={numeroManuale}
                    onChange={(e) => { setNumeroManuale(e.target.checked); if (e.target.checked && !numero) setNumero(String(proposto ?? "")); }} />
                  Scegli il numero a mano
                </label>
              )}
            </div>
          </section>

          <section className="card p-5 space-y-3" aria-labelledby="t-note">
            <div className="flex items-center justify-between gap-2">
              <h2 id="t-note" className="font-semibold text-red-800 flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" /> Da verificare</h2>
              {modificabile && <button className="btn-ghost text-xs" onClick={ricontrolla}><RefreshCw size={14} aria-hidden="true" /> Ricontrolla</button>}
            </div>
            <p className="text-xs text-gray-600">Queste note vengono stampate in rosso nel mandato. Correggi i dati e cancella le note risolte.</p>
            {s.note.length === 0 && <p className="text-sm text-green-800">Nessuna segnalazione.</p>}
            <ul className="space-y-2">
              {s.note.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <label htmlFor={`m-nota-${i}`} className="sr-only">Nota {i + 1}</label>
                  <textarea id={`m-nota-${i}`} className="input text-sm text-red-800" rows={2} value={n} disabled={!modificabile}
                    onChange={(e) => set({ note: s.note.map((x, j) => (j === i ? e.target.value : x)) })} />
                  {modificabile && (
                    <button className="btn-ghost p-1 text-gray-600 self-start" onClick={() => set({ note: s.note.filter((_, j) => j !== i) })} aria-label={`Elimina nota ${i + 1}`} title="Elimina nota">
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {modificabile && <button className="btn-ghost text-sm" onClick={() => set({ note: [...s.note, ""] })}><Plus size={14} aria-hidden="true" /> Aggiungi nota</button>}
          </section>

          <section className="card p-5 space-y-2 text-sm" aria-labelledby="t-collegamenti">
            <h2 id="t-collegamenti" className="font-semibold text-gray-900 flex items-center gap-2"><Link2 size={18} aria-hidden="true" /> Collegamenti</h2>
            {scadenzaId ? <p><Link to={`/scadenzario/${scadenzaId}`} className="text-primary-700 hover:underline">Pagamento nello scadenzario</Link></p> : <p className="text-gray-600">Nessun pagamento dello scadenzario collegato.</p>}
            {giustificativoId ? <p><Link to={`/giustificativi/${giustificativoId}`} className="text-primary-700 hover:underline">Giustificativo di spesa</Link></p> : <p className="text-gray-600">Nessun giustificativo collegato.</p>}
            {collegati.map((c) => (
              <p key={c.id}>
                <Link to={`/mandati/${c.id}`} className="text-primary-700 hover:underline">
                  {c.modalita === "f24" ? "Mandato F24 collegato" : "Mandato collegato"} n. {numeroStampa(c)}
                </Link>{" "}
                <span className="text-gray-600">({STATO_MANDATO_LABELS[c.stato].toLowerCase()})</span>
              </p>
            ))}
            {mandato?.docx_path && <p className="text-gray-600">Word archiviato al momento della verifica.</p>}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={conferma === "verifica"}
        title="Confermi il mandato?"
        message={`Confermi di aver controllato beneficiario, IBAN, importi e causale? Il mandato n. ${mandato ? numeroStampa(mandato) : `${proposto ?? ""}/${anno}`} perde la scritta BOZZA, viene archiviato e scaricato in Word.${s.note.length ? ` Restano ${s.note.length} note "da verificare" che verranno stampate in rosso.` : ""}`}
        confirmLabel="Sì, confermo"
        onConfirm={verifica}
        onCancel={() => setConferma(null)}
      />
      <ConfirmDialog
        open={conferma === "doppio"}
        danger
        title="Possibile doppio pagamento"
        message={`Per questo documento esiste già il mandato ${doppioni.map((d) => `n. ${numeroStampa(d)} (${STATO_MANDATO_LABELS[d.stato].toLowerCase()})`).join(", ")}. Vuoi davvero salvarne un altro?`}
        confirmLabel="Salva comunque"
        onConfirm={() => { setConferma(null); salva(true); }}
        onCancel={() => setConferma(null)}
      />
      <ConfirmDialog
        open={conferma === "annulla"}
        danger
        title="Annullare il mandato?"
        message="Il mandato resta nel registro con il suo numero (che non verrà riusato) e viene tolto dallo scadenzario pagamenti."
        confirmLabel="Annulla mandato"
        onConfirm={async () => { setConferma(null); await cambiaStato("annullato", {}, "Mandato annullato"); }}
        onCancel={() => setConferma(null)}
      />
      <ConfirmDialog
        open={conferma === "bozza"}
        title="Riportare in bozza?"
        message="Potrai correggere i dati; dovrai poi confermarlo di nuovo. Il Word già archiviato verrà sostituito alla nuova conferma."
        confirmLabel="Riporta in bozza"
        onConfirm={async () => { setConferma(null); await cambiaStato("bozza", { verificato_da: null, verificato_il: null }, "Mandato riportato in bozza"); }}
        onCancel={() => setConferma(null)}
      />
      <ConfirmDialog
        open={conferma === "elimina"}
        danger
        title="Eliminare la bozza?"
        message="La bozza viene eliminata. Il suo numero non verrà riassegnato (resterà un salto nella numerazione): se vuoi conservarlo, correggi la bozza invece di eliminarla."
        confirmLabel="Elimina"
        onConfirm={elimina}
        onCancel={() => setConferma(null)}
      />
    </div>
  );
}
