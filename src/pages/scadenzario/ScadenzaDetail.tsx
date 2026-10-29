// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import clsx from "clsx";
import {
  ArrowLeft, Pencil, Banknote, FileDown, Trash2, Loader2, Upload, ExternalLink, ShieldCheck,
  ShieldAlert, Receipt, Ban, RotateCcw, Link2, FileText,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit } from "../../lib/utils";
import { etichettaScadenza, oggiISO, scadenzaAperta, scadenzaF24 } from "../../lib/scadenze";
import {
  apriAllegato, caricaAllegato, generaF24Collegati, generaSchedaMandato, prossimoNumeroMandato,
} from "../../lib/scadenzario";
import {
  MODALITA_PAGAMENTO_LABELS, STATO_SCADENZA_COLORS, STATO_SCADENZA_LABELS, TIPO_SCADENZA_LABELS,
} from "../../constants";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import ScadenzaForm, { payloadDaForm, ScadenzaFormValues, ScadenzaSubmitValues } from "../../components/scadenzario/ScadenzaForm";
import type { ContoCorrente, ModalitaPagamento, ScadenzaPagamento } from "../../types";

type F24Row = Pick<ScadenzaPagamento, "id" | "descrizione" | "importo_da_pagare" | "data_scadenza" | "stato">;

interface PagamentoForm {
  data_pagamento: string;
  conto_id: string;
  modalita_pagamento: ModalitaPagamento;
  cro_trn: string;
  importo_pagato: number;
  mandato_numero: string;
  mandato_data: string;
}

export default function ScadenzaDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [s, setS] = useState<ScadenzaPagamento | null>(null);
  const [conti, setConti] = useState<ContoCorrente[]>([]);
  const [f24, setF24] = useState<F24Row[]>([]);
  const [origine, setOrigine] = useState<Pick<ScadenzaPagamento, "id" | "beneficiario" | "descrizione"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showPaga, setShowPaga] = useState(false);
  const [showMandato, setShowMandato] = useState(false);
  const [pag, setPag] = useState<PagamentoForm | null>(null);
  const [contabile, setContabile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"annulla" | "elimina" | "ripristina" | null>(null);
  const [mandatoCollegato, setMandatoCollegato] = useState<{ id: string; numero: number; anno: number } | null>(null);

  async function load() {
    if (!id) return;
    supabase.from("gal_mandati").select("id, numero, anno").eq("scadenza_id", id).neq("stato", "annullato")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error(error); // database senza il modulo mandati: nessun collegamento
        setMandatoCollegato((data ?? null) as { id: string; numero: number; anno: number } | null);
      });
    const { data, error } = await supabase.from("gal_scadenze_pagamento").select("*").eq("id", id).single();
    if (error || !data) {
      console.error(error);
      toast.error("Scadenza non trovata");
      navigate("/scadenzario");
      return;
    }
    const sc = data as ScadenzaPagamento;
    setS(sc);
    const [cRes, fRes, oRes] = await Promise.all([
      supabase.from("gal_conti").select("*").eq("gal_id", sc.gal_id).order("nome"),
      supabase.from("gal_scadenze_pagamento").select("id, descrizione, importo_da_pagare, data_scadenza, stato").eq("scadenza_origine_id", sc.id).order("data_scadenza"),
      sc.scadenza_origine_id
        ? supabase.from("gal_scadenze_pagamento").select("id, beneficiario, descrizione").eq("id", sc.scadenza_origine_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (cRes.error) console.error(cRes.error);
    setConti((cRes.data ?? []) as ContoCorrente[]);
    setF24((fRes.data ?? []) as F24Row[]);
    setOrigine((oRes.data ?? null) as Pick<ScadenzaPagamento, "id" | "beneficiario" | "descrizione"> | null);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  if (loading || !s) {
    return <div className="flex items-center justify-center gap-2 text-gray-400 py-20"><Loader2 className="animate-spin" size={18} /> Caricamento…</div>;
  }

  const sc = s;
  const conto = conti.find((c) => c.id === sc.conto_id) ?? null;
  const aperta = scadenzaAperta(sc);
  const et = etichettaScadenza(sc.data_scadenza);
  const isFattura = ["fattura", "parcella"].includes(sc.tipo);
  const traccOk = !!sc.cup && (sc.cig_esente || !!sc.cig) && (!isFattura || (sc.cup_in_fattura && (sc.cig_esente || sc.cig_in_fattura)));

  async function audit(azione: string, descrizione: string) {
    if (!currentGal || !user) return;
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione, entita: "scadenza_pagamento", entitaId: sc.id, descrizione });
  }

  async function handleEdit(v: ScadenzaSubmitValues, fattura: File | null) {
    const patch: Record<string, unknown> = { ...payloadDaForm(v) };
    if (fattura) {
      try {
        patch.fattura_path = await caricaAllegato(sc.gal_id, sc.id, "fattura", fattura);
        patch.fattura_nome = fattura.name;
      } catch (err) {
        console.error(err);
        toast.error("Caricamento della fattura non riuscito");
        return;
      }
    }
    const { error } = await supabase.from("gal_scadenze_pagamento").update(patch).eq("id", sc.id);
    if (error) { console.error(error); toast.error("Salvataggio non riuscito. Riprova."); return; }
    // Se già pagata, riallinea gli F24 collegati con i nuovi importi
    if (sc.stato === "pagata" && sc.data_pagamento) {
      try { await generaF24Collegati({ ...sc, ...(patch as Partial<ScadenzaPagamento>) }, sc.data_pagamento); }
      catch (err) { console.error(err); toast.warning("Scadenza aggiornata, ma gli F24 collegati non sono stati riallineati."); }
    }
    await audit("UPDATE", `${v.beneficiario} — ${formatCurrency(v.importo_da_pagare)}`);
    toast.success("Scadenza aggiornata");
    setShowEdit(false);
    load();
  }

  async function apriPagamento() {
    let numero = sc.mandato_numero ?? "";
    if (!numero) {
      try { numero = await prossimoNumeroMandato(sc.gal_id, new Date().getFullYear()); }
      catch (err) { console.error(err); }
    }
    setPag({
      data_pagamento: oggiISO(),
      conto_id: sc.conto_id ?? conti.find((c) => c.attivo)?.id ?? "",
      modalita_pagamento: sc.modalita_pagamento ?? (sc.tipo === "f24" ? "f24" : "bonifico"),
      cro_trn: "",
      importo_pagato: Number(sc.importo_da_pagare),
      mandato_numero: numero,
      mandato_data: sc.mandato_data ?? oggiISO(),
    });
    setContabile(null);
    setShowPaga(true);
  }

  async function registraPagamento(e: React.FormEvent) {
    e.preventDefault();
    if (!pag) return;
    if (!pag.conto_id) { toast.error("Seleziona il conto da cui è stato effettuato il pagamento"); return; }
    if (!pag.data_pagamento) { toast.error("Indica la data del pagamento"); return; }
    if (pag.importo_pagato <= 0) { toast.error("L'importo pagato deve essere maggiore di zero"); return; }
    setBusy(true);
    const patch: Partial<ScadenzaPagamento> = {
      stato: "pagata",
      data_pagamento: pag.data_pagamento,
      conto_id: pag.conto_id,
      modalita_pagamento: pag.modalita_pagamento,
      cro_trn: pag.cro_trn || null,
      importo_pagato: pag.importo_pagato,
      mandato_numero: pag.mandato_numero || null,
      mandato_data: pag.mandato_data || null,
    };
    if (contabile) {
      try {
        patch.bonifico_path = await caricaAllegato(sc.gal_id, sc.id, "bonifico", contabile);
        patch.bonifico_nome = contabile.name;
      } catch (err) {
        console.error(err);
        toast.error("Caricamento della contabile non riuscito. Riprova.");
        setBusy(false);
        return;
      }
    }
    const { error } = await supabase.from("gal_scadenze_pagamento").update(patch).eq("id", sc.id);
    if (error) { console.error(error); toast.error("Registrazione del pagamento non riuscita. Riprova."); setBusy(false); return; }

    let nF24 = 0;
    try { nF24 = await generaF24Collegati({ ...sc, ...patch }, pag.data_pagamento); }
    catch (err) { console.error(err); toast.warning("Pagamento registrato, ma non è stato possibile creare la scadenza F24. Inseriscila manualmente."); }

    await audit("UPDATE", `Pagamento registrato: ${formatCurrency(pag.importo_pagato)} — ${sc.beneficiario}`);
    setBusy(false);
    setShowPaga(false);
    toast.success("Pagamento registrato", {
      description: nF24 ? `Creata scadenza F24 entro il ${formatDate(scadenzaF24(pag.data_pagamento))}` : undefined,
    });
    load();
  }

  async function caricaContabile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const path = await caricaAllegato(sc.gal_id, sc.id, "bonifico", file);
      const { error } = await supabase.from("gal_scadenze_pagamento").update({ bonifico_path: path, bonifico_nome: file.name }).eq("id", sc.id);
      if (error) throw error;
      toast.success("Contabile caricata");
      load();
    } catch (err) {
      console.error(err);
      toast.error("Caricamento non riuscito");
    } finally { setBusy(false); }
  }

  async function caricaFattura(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const path = await caricaAllegato(sc.gal_id, sc.id, "fattura", file);
      const { error } = await supabase.from("gal_scadenze_pagamento").update({ fattura_path: path, fattura_nome: file.name }).eq("id", sc.id);
      if (error) throw error;
      toast.success("Documento caricato");
      load();
    } catch (err) {
      console.error(err);
      toast.error("Caricamento non riuscito");
    } finally { setBusy(false); }
  }

  async function apri(path: string | null) {
    if (!path) return;
    try { await apriAllegato(path); } catch (err) { console.error(err); toast.error("Impossibile aprire il documento"); }
  }

  async function salvaMandato(e: React.FormEvent) {
    e.preventDefault();
    if (!pag) return;
    const { error } = await supabase.from("gal_scadenze_pagamento")
      .update({ mandato_numero: pag.mandato_numero || null, mandato_data: pag.mandato_data || null }).eq("id", sc.id);
    if (error) { console.error(error); toast.error("Salvataggio non riuscito"); return; }
    toast.success("Estremi del mandato aggiornati");
    setShowMandato(false);
    load();
  }

  function scaricaScheda() {
    if (sc.stato !== "pagata") { toast.error("La scheda per il mandato si genera dopo aver registrato il pagamento"); return; }
    if (!sc.cup) { toast.error("Manca il CUP: completare la scadenza prima di generare la scheda"); return; }
    try {
      generaSchedaMandato({ scadenza: sc, conto, gal: currentGal, f24Collegati: f24 });
      toast.success("Scheda mandato scaricata");
    } catch (err) {
      console.error(err);
      toast.error("Non è stato possibile generare la scheda");
    }
  }

  async function eseguiConferma() {
    const azione = confirm;
    setConfirm(null);
    if (azione === "elimina") {
      const { error } = await supabase.from("gal_scadenze_pagamento").delete().eq("id", sc.id);
      if (error) { console.error(error); toast.error("Eliminazione non riuscita"); return; }
      await audit("DELETE", `${sc.beneficiario} — ${sc.descrizione}`);
      toast.success("Scadenza eliminata");
      navigate("/scadenzario");
      return;
    }
    const patch: Partial<ScadenzaPagamento> = azione === "annulla"
      ? { stato: "annullata" }
      : { stato: "da_pagare", data_pagamento: null, cro_trn: null, importo_pagato: null };
    const { error } = await supabase.from("gal_scadenze_pagamento").update(patch).eq("id", sc.id);
    if (error) { console.error(error); toast.error("Operazione non riuscita"); return; }
    await audit("UPDATE", azione === "annulla" ? "Scadenza annullata" : "Pagamento stornato");
    toast.success(azione === "annulla" ? "Scadenza annullata" : "Scadenza riportata a 'da pagare'");
    load();
  }

  const formInit: ScadenzaFormValues = {
    tipo: sc.tipo, fornitore_id: sc.fornitore_id ?? "", beneficiario: sc.beneficiario,
    beneficiario_piva: sc.beneficiario_piva ?? "", beneficiario_cf: sc.beneficiario_cf ?? "",
    beneficiario_iban: sc.beneficiario_iban ?? "", descrizione: sc.descrizione,
    numero_documento: sc.numero_documento ?? "", data_documento: sc.data_documento ?? "",
    imponibile: Number(sc.imponibile), iva: Number(sc.iva), split_payment: sc.split_payment,
    ritenuta: Number(sc.ritenuta), ritenuta_codice_tributo: sc.ritenuta_codice_tributo ?? "",
    cup: sc.cup, cup_in_fattura: sc.cup_in_fattura, cig: sc.cig ?? "", cig_esente: sc.cig_esente,
    cig_motivo_esenzione: sc.cig_motivo_esenzione ?? "", cig_in_fattura: sc.cig_in_fattura,
    verifica_note: sc.verifica_note ?? "", intervento: sc.intervento ?? "", capitolo: sc.capitolo ?? "",
    data_scadenza: sc.data_scadenza, note: sc.note ?? "",
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Intestazione */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <button className="btn-ghost p-1.5 mt-0.5" onClick={() => navigate("/scadenzario")} title="Torna allo scadenzario"><ArrowLeft size={18} /></button>
          <div>
            <div className="text-xs text-gray-400">{TIPO_SCADENZA_LABELS[sc.tipo]}{sc.numero_documento ? ` n. ${sc.numero_documento} del ${formatDate(sc.data_documento)}` : ""}</div>
            <h1 className="text-xl font-bold text-gray-900">{sc.beneficiario}</h1>
            <p className="text-sm text-gray-600">{sc.descrizione}</p>
            <div className="flex gap-2 mt-2 flex-wrap items-center">
              <span className={clsx("badge", STATO_SCADENZA_COLORS[sc.stato])}>{STATO_SCADENZA_LABELS[sc.stato]}</span>
              {aperta && <span className={clsx("text-xs", et.classe)}>{et.testo}</span>}
              {traccOk
                ? <span className="badge bg-green-50 text-green-700"><ShieldCheck size={12} className="mr-1" />Tracciabilità verificata</span>
                : <span className="badge bg-amber-50 text-amber-700"><ShieldAlert size={12} className="mr-1" />Verifica CUP/CIG incompleta</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {mandatoCollegato
            ? <Link to={`/mandati/${mandatoCollegato.id}`} className="btn-secondary"><FileText size={16} aria-hidden="true" /> Mandato n. {mandatoCollegato.numero}/{mandatoCollegato.anno}</Link>
            : write && sc.stato !== "annullata" && <Link to={`/mandati/nuovo?scadenza=${sc.id}`} className="btn-primary"><FileText size={16} aria-hidden="true" /> Crea mandato</Link>}
          <button className={clsx(sc.stato === "pagata" ? "btn-primary" : "btn-secondary")} onClick={scaricaScheda} disabled={sc.stato !== "pagata"}
            title={sc.stato !== "pagata" ? "Disponibile dopo la registrazione del pagamento" : "Scarica la scheda per il mandato di pagamento"}>
            <FileDown size={16} /> Scheda mandato
          </button>
          {write && aperta && <button className="btn-primary" onClick={apriPagamento}><Banknote size={16} /> Registra pagamento</button>}
          {write && (aperta || isAdmin(user)) && <button className="btn-secondary" onClick={() => setShowEdit(true)}><Pencil size={16} /> Modifica</button>}
          {write && aperta && <button className="btn-ghost text-gray-500" onClick={() => setConfirm("annulla")} title="Annulla scadenza"><Ban size={16} /></button>}
          {isAdmin(user) && sc.stato === "pagata" && <button className="btn-ghost text-gray-500" onClick={() => setConfirm("ripristina")} title="Storna pagamento"><RotateCcw size={16} /></button>}
          {isAdmin(user) && <button className="btn-ghost text-red-600" onClick={() => setConfirm("elimina")} title="Elimina"><Trash2 size={16} /></button>}
        </div>
      </div>

      {origine && (
        <Link to={`/scadenzario/${origine.id}`} className="card p-3 flex items-center gap-2 text-sm text-primary-700 hover:bg-primary-50">
          <Link2 size={16} /> F24 generato dal pagamento a <strong>{origine.beneficiario}</strong> — {origine.descrizione}
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Importi */}
          <div className="card p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Importi</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Dato label="Imponibile" value={formatCurrency(sc.imponibile)} />
              <Dato label="IVA" value={formatCurrency(sc.iva)} />
              <Dato label="Totale documento" value={formatCurrency(sc.totale_documento)} />
              <Dato label="Split payment" value={sc.split_payment ? `Sì — IVA ${formatCurrency(sc.iva)} all'Erario` : "No"} />
              <Dato label="Ritenuta d'acconto" value={sc.ritenuta > 0 ? `${formatCurrency(sc.ritenuta)}${sc.ritenuta_codice_tributo ? ` (cod. ${sc.ritenuta_codice_tributo})` : ""}` : "—"} />
              <Dato label="Netto da pagare" value={<span className="text-lg font-bold text-primary-800">{formatCurrency(sc.importo_da_pagare)}</span>} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mt-4 pt-4 border-t">
              <Dato label="Scadenza" value={formatDate(sc.data_scadenza)} />
              <Dato label="Intervento" value={sc.intervento || "—"} />
              <Dato label="Capitolo" value={sc.capitolo || "—"} />
              <Dato label="P.IVA / C.F." value={[sc.beneficiario_piva, sc.beneficiario_cf].filter(Boolean).join(" / ") || "—"} />
              <div className="col-span-2"><Dato label="IBAN beneficiario" value={<span className="font-mono text-xs">{sc.beneficiario_iban || "—"}</span>} /></div>
            </div>
            {sc.note && <p className="text-sm text-gray-600 mt-4 pt-4 border-t whitespace-pre-wrap">{sc.note}</p>}
          </div>

          {/* Tracciabilità */}
          <div className="card p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Tracciabilità e verifiche</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">CUP</div>
                <div className="font-mono font-semibold">{sc.cup}</div>
                {sc.tipo !== "f24" && <Esito ok={sc.cup_in_fattura} si="Riportato in fattura" no="Non verificato / assente in fattura" />}
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs text-gray-500">CIG</div>
                {sc.cig_esente ? (
                  <><div className="font-semibold">Non dovuto</div><div className="text-xs text-gray-500">{sc.cig_motivo_esenzione}</div></>
                ) : (
                  <><div className="font-mono font-semibold">{sc.cig || "—"}</div>
                    {sc.tipo !== "f24" && <Esito ok={sc.cig_in_fattura} si="Riportato in fattura" no="Non verificato / assente in fattura" />}</>
                )}
              </div>
            </div>
            {sc.verifica_note && <p className="text-xs text-gray-600 mt-3">Note: {sc.verifica_note}</p>}
          </div>

          {/* F24 collegati */}
          {f24.length > 0 && (
            <div className="card p-4">
              <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Receipt size={18} /> F24 collegati</h2>
              <ul className="divide-y">
                {f24.map((f) => (
                  <li key={f.id}>
                    <Link to={`/scadenzario/${f.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-gray-50 px-1 rounded">
                      <span className="flex-1">{f.descrizione}</span>
                      <span className="whitespace-nowrap text-gray-500">entro {formatDate(f.data_scadenza)}</span>
                      <span className="font-semibold whitespace-nowrap">{formatCurrency(f.importo_da_pagare)}</span>
                      <span className={clsx("badge", STATO_SCADENZA_COLORS[f.stato])}>{STATO_SCADENZA_LABELS[f.stato]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-5">
          {/* Pagamento */}
          <div className="card p-4 space-y-2 text-sm">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Banknote size={18} /> Pagamento</h2>
            {sc.stato === "pagata" ? (
              <>
                <Riga label="Pagato il" value={formatDate(sc.data_pagamento)} />
                <Riga label="Importo" value={formatCurrency(sc.importo_pagato ?? sc.importo_da_pagare)} />
                <Riga label="Conto" value={conto ? conto.nome : "—"} />
                {conto?.iban && <Riga label="IBAN" value={<span className="font-mono text-xs">{conto.iban}</span>} />}
                <Riga label="Modalità" value={sc.modalita_pagamento ? MODALITA_PAGAMENTO_LABELS[sc.modalita_pagamento] : "—"} />
                <Riga label="CRO / TRN" value={sc.cro_trn || "—"} />
                <div className="pt-2 mt-2 border-t">
                  <Riga label="Mandato n." value={sc.mandato_numero || "—"} />
                  <Riga label="del" value={formatDate(sc.mandato_data)} />
                  {write && (
                    <button className="text-xs text-primary-700 hover:underline mt-1" onClick={() => {
                      setPag({ data_pagamento: sc.data_pagamento ?? "", conto_id: sc.conto_id ?? "", modalita_pagamento: sc.modalita_pagamento ?? "bonifico", cro_trn: sc.cro_trn ?? "", importo_pagato: Number(sc.importo_pagato ?? 0), mandato_numero: sc.mandato_numero ?? "", mandato_data: sc.mandato_data ?? oggiISO() });
                      setShowMandato(true);
                    }}>Modifica estremi del mandato</button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-gray-500">{sc.stato === "annullata" ? "Scadenza annullata." : "Non ancora pagata."}</p>
            )}
          </div>

          {/* Documenti */}
          <div className="card p-4 space-y-3 text-sm">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><FileText size={18} /> Documenti</h2>
            <Documento titolo="Fattura / documento di spesa" nome={sc.fattura_nome} onOpen={() => apri(sc.fattura_path)}
              onUpload={write ? caricaFattura : undefined} busy={busy} />
            <Documento titolo="Contabile bonifico / quietanza" nome={sc.bonifico_nome} onOpen={() => apri(sc.bonifico_path)}
              onUpload={write ? caricaContabile : undefined} busy={busy} />
          </div>
        </div>
      </div>

      {/* Modifica */}
      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Modifica scadenza" size="xl">
        <ScadenzaForm galId={sc.gal_id} modalita="modifica" initial={formInit} onSubmit={handleEdit} onCancel={() => setShowEdit(false)} />
      </Modal>

      {/* Registra pagamento */}
      <Modal open={showPaga} onClose={() => setShowPaga(false)} title="Registra pagamento" size="lg">
        {pag && (
          <form onSubmit={registraPagamento} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm flex justify-between">
              <span>{sc.beneficiario}</span>
              <span className="font-bold">{formatCurrency(sc.importo_da_pagare)}</span>
            </div>
            {conti.length === 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                Nessun conto configurato. Aggiungi i conti del GAL dalla pagina <Link className="underline" to="/cash-flow">Cash flow → Conti</Link>.
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="label">Data pagamento *</label>
                <input type="date" className="input" value={pag.data_pagamento} onChange={(e) => setPag({ ...pag, data_pagamento: e.target.value })} />
              </div>
              <div>
                <label className="label">Pagato dal conto *</label>
                <select className="input" value={pag.conto_id} onChange={(e) => setPag({ ...pag, conto_id: e.target.value })}>
                  <option value="">Seleziona…</option>
                  {conti.filter((c) => c.attivo || c.id === pag.conto_id).map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banca ? ` — ${c.banca}` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Modalità</label>
                <select className="input" value={pag.modalita_pagamento} onChange={(e) => setPag({ ...pag, modalita_pagamento: e.target.value as ModalitaPagamento })}>
                  {(Object.keys(MODALITA_PAGAMENTO_LABELS) as ModalitaPagamento[]).map((m) => <option key={m} value={m}>{MODALITA_PAGAMENTO_LABELS[m]}</option>)}
                </select>
              </div>
              <div>
                <label className="label">CRO / TRN</label>
                <input className="input font-mono" value={pag.cro_trn} onChange={(e) => setPag({ ...pag, cro_trn: e.target.value.toUpperCase() })} placeholder="Codice identificativo del bonifico" />
              </div>
              <div>
                <label className="label">Importo pagato €</label>
                <input type="number" step="0.01" min="0" className="input text-right" value={pag.importo_pagato || ""} onChange={(e) => setPag({ ...pag, importo_pagato: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="label">Contabile del bonifico</label>
                <label className="btn-secondary cursor-pointer w-full justify-center">
                  <Upload size={16} /> <span className="truncate">{contabile ? contabile.name : "Carica file"}</span>
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff" onChange={(e) => { setContabile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                </label>
              </div>
              <div>
                <label className="label">Mandato n.</label>
                <input className="input" value={pag.mandato_numero} onChange={(e) => setPag({ ...pag, mandato_numero: e.target.value })} />
              </div>
              <div>
                <label className="label">Data mandato</label>
                <input type="date" className="input" value={pag.mandato_data} onChange={(e) => setPag({ ...pag, mandato_data: e.target.value })} />
              </div>
            </div>
            {Math.abs(pag.importo_pagato - Number(sc.importo_da_pagare)) > 0.009 && (
              <p className="text-xs text-amber-800 bg-amber-50 rounded p-2">L'importo pagato è diverso dal netto da pagare ({formatCurrency(sc.importo_da_pagare)}).</p>
            )}
            {(sc.ritenuta > 0 || (sc.split_payment && sc.iva > 0)) && pag.data_pagamento && (
              <p className="text-xs text-purple-800 bg-purple-50 rounded p-2">
                Verrà creata la scadenza F24 entro il <strong>{formatDate(scadenzaF24(pag.data_pagamento))}</strong>
                {sc.ritenuta > 0 ? ` — ritenuta ${formatCurrency(sc.ritenuta)}` : ""}
                {sc.split_payment && sc.iva > 0 ? ` — IVA split ${formatCurrency(sc.iva)}` : ""}.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" className="btn-secondary" onClick={() => setShowPaga(false)}>Annulla</button>
              <button type="submit" className="btn-primary" disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />} Conferma pagamento</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Estremi mandato */}
      <Modal open={showMandato} onClose={() => setShowMandato(false)} title="Estremi del mandato" size="sm">
        {pag && (
          <form onSubmit={salvaMandato} className="space-y-3">
            <div><label className="label">Mandato n.</label><input className="input" value={pag.mandato_numero} onChange={(e) => setPag({ ...pag, mandato_numero: e.target.value })} /></div>
            <div><label className="label">Data mandato</label><input type="date" className="input" value={pag.mandato_data} onChange={(e) => setPag({ ...pag, mandato_data: e.target.value })} /></div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" className="btn-secondary" onClick={() => setShowMandato(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Salva</button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === "elimina"}
        title={confirm === "elimina" ? "Eliminare la scadenza?" : confirm === "annulla" ? "Annullare la scadenza?" : "Stornare il pagamento?"}
        message={
          confirm === "elimina" ? "La scadenza verrà eliminata definitivamente. Gli F24 collegati resteranno ma senza riferimento."
            : confirm === "annulla" ? "La scadenza non verrà più considerata nei pagamenti da effettuare né nel cash flow."
              : "La scadenza tornerà 'da pagare'. Gli F24 già creati non vengono eliminati: verificali manualmente."
        }
        confirmLabel={confirm === "elimina" ? "Elimina" : "Conferma"}
        onConfirm={eseguiConferma}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function Dato({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-xs text-gray-500">{label}</div><div className="text-gray-900">{value}</div></div>;
}

function Riga({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><span className="text-gray-500">{label}</span><span className="text-gray-900 text-right">{value}</span></div>;
}

function Esito({ ok, si, no }: { ok: boolean; si: string; no: string }) {
  return (
    <div className={clsx("text-xs mt-1 flex items-center gap-1", ok ? "text-green-700" : "text-amber-700")}>
      {ok ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}{ok ? si : no}
    </div>
  );
}

function Documento({ titolo, nome, onOpen, onUpload, busy }: {
  titolo: string; nome: string | null; onOpen: () => void;
  onUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void; busy: boolean;
}) {
  return (
    <div className="border rounded-lg p-2.5">
      <div className="text-xs text-gray-500 mb-1">{titolo}</div>
      {nome ? (
        <button onClick={onOpen} className="flex items-center gap-1.5 text-primary-700 hover:underline text-left w-full">
          <ExternalLink size={13} className="flex-shrink-0" /><span className="truncate">{nome}</span>
        </button>
      ) : <div className="text-gray-400 text-xs">Nessun file</div>}
      {onUpload && (
        <label className="text-xs text-gray-600 hover:text-primary-700 cursor-pointer flex items-center gap-1 mt-1.5">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {nome ? "Sostituisci" : "Carica"}
          <input type="file" className="hidden" accept=".xml,.p7m,.pdf,.jpg,.jpeg,.png,.tif,.tiff,.doc,.docx" onChange={onUpload} disabled={busy} />
        </label>
      )}
    </div>
  );
}
