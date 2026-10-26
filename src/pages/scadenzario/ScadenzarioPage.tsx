// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import clsx from "clsx";
import * as XLSX from "xlsx";
import {
  Plus, Search, AlertTriangle, CalendarClock, Wallet, CheckCircle2, Receipt, FileSpreadsheet,
  FileDown, Loader2, Paperclip, Landmark, ShieldCheck, ShieldAlert,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit } from "../../lib/utils";
import { generateTablePdf, pdfDate, pdfEur } from "../../lib/pdf";
import { etichettaScadenza, giorniAllaScadenza, oggiISO, scadenzaAperta } from "../../lib/scadenze";
import { caricaAllegato } from "../../lib/scadenzario";
import {
  STATO_SCADENZA_COLORS, STATO_SCADENZA_LABELS, TIPO_SCADENZA_LABELS,
} from "../../constants";
import Modal from "../../components/ui/Modal";
import StatCard from "../../components/ui/StatCard";
import ScadenzaForm, { scadenzaFormVuota, payloadDaForm, ScadenzaSubmitValues } from "../../components/scadenzario/ScadenzaForm";
import type { ScadenzaPagamento, TipoScadenzaPagamento } from "../../types";

type FiltroStato = "aperte" | "scadute" | "pagate" | "tutte";

export default function ScadenzarioPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [scadenze, setScadenze] = useState<ScadenzaPagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStato, setFiltroStato] = useState<FiltroStato>("aperte");
  const [tipo, setTipo] = useState<TipoScadenzaPagamento | "">("");
  const [search, setSearch] = useState("");
  const [anno, setAnno] = useState<number>(new Date().getFullYear());
  const [showModal, setShowModal] = useState(false);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("gal_scadenze_pagamento")
      .select("*, conto:gal_conti(nome, banca, iban)")
      .eq("gal_id", currentGal.id)
      .order("data_scadenza", { ascending: true });
    if (error) {
      console.error(error);
      toast.error("Impossibile caricare lo scadenzario. Verifica che l'aggiornamento del database 4.0 sia stato eseguito.");
    } else {
      setScadenze((data ?? []) as ScadenzaPagamento[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  const anni = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear()]);
    scadenze.forEach((x) => s.add(parseInt(x.data_scadenza.slice(0, 4), 10)));
    return [...s].sort((a, b) => b - a);
  }, [scadenze]);

  const filtrate = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scadenze.filter((s) => {
      if (filtroStato === "aperte" && !scadenzaAperta(s)) return false;
      if (filtroStato === "scadute" && !(scadenzaAperta(s) && giorniAllaScadenza(s.data_scadenza) < 0)) return false;
      if (filtroStato === "pagate") {
        if (s.stato !== "pagata") return false;
        if (!(s.data_pagamento ?? s.data_scadenza).startsWith(String(anno))) return false;
      }
      if (filtroStato === "tutte" && !s.data_scadenza.startsWith(String(anno))) return false;
      if (tipo && s.tipo !== tipo) return false;
      if (q && ![s.beneficiario, s.descrizione, s.numero_documento ?? "", s.cig ?? "", s.cup, s.mandato_numero ?? ""]
        .some((x) => x.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [scadenze, filtroStato, tipo, search, anno]);

  const kpi = useMemo(() => {
    const aperte = scadenze.filter(scadenzaAperta);
    const somma = (l: ScadenzaPagamento[]) => l.reduce((t, s) => t + Number(s.importo_da_pagare), 0);
    const scadute = aperte.filter((s) => giorniAllaScadenza(s.data_scadenza) < 0);
    const entro30 = aperte.filter((s) => { const g = giorniAllaScadenza(s.data_scadenza); return g >= 0 && g <= 30; });
    const f24 = aperte.filter((s) => s.tipo === "f24");
    const annoCorr = String(new Date().getFullYear());
    const pagate = scadenze.filter((s) => s.stato === "pagata" && (s.data_pagamento ?? "").startsWith(annoCorr));
    return {
      scaduteN: scadute.length, scaduteTot: somma(scadute),
      entro30N: entro30.length, entro30Tot: somma(entro30),
      aperteN: aperte.length, aperteTot: somma(aperte),
      f24N: f24.length, f24Tot: somma(f24),
      pagateTot: pagate.reduce((t, s) => t + Number(s.importo_pagato ?? s.importo_da_pagare), 0),
    };
  }, [scadenze]);

  const totaleFiltrate = filtrate.reduce((t, s) => t + Number(s.importo_da_pagare), 0);

  async function handleCreate(v: ScadenzaSubmitValues, fattura: File | null) {
    if (!currentGal || !user) return;
    const { data, error } = await supabase.from("gal_scadenze_pagamento").insert({
      ...payloadDaForm(v),
      gal_id: currentGal.id,
      stato: "da_pagare",
      modalita_pagamento: v.tipo === "f24" ? "f24" : "bonifico",
      created_by: user.id,
    }).select("id").single();
    if (error || !data) {
      console.error(error);
      toast.error("Non è stato possibile salvare la scadenza. Riprova.");
      return;
    }
    if (fattura) {
      try {
        const path = await caricaAllegato(currentGal.id, data.id, "fattura", fattura);
        const { error: uErr } = await supabase.from("gal_scadenze_pagamento").update({ fattura_path: path, fattura_nome: fattura.name }).eq("id", data.id);
        if (uErr) throw uErr;
      } catch (err) {
        console.error(err);
        toast.warning("Scadenza salvata, ma il caricamento della fattura non è riuscito. Riprova dal dettaglio.");
      }
    }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "scadenza_pagamento", entitaId: data.id, descrizione: `${v.beneficiario} — ${formatCurrency(v.importo_da_pagare)}` });
    toast.success("Scadenza inserita nello scadenzario");
    setShowModal(false);
    navigate(`/scadenzario/${data.id}`);
  }

  function righeExport() {
    return filtrate.map((s) => ({
      scadenza: pdfDate(s.data_scadenza),
      tipo: TIPO_SCADENZA_LABELS[s.tipo],
      beneficiario: s.beneficiario,
      descrizione: s.descrizione,
      documento: s.numero_documento ? `${s.numero_documento} del ${pdfDate(s.data_documento)}` : "—",
      cup: s.cup,
      cig: s.cig_esente ? "Non dovuto" : s.cig ?? "—",
      totale: pdfEur(s.totale_documento),
      netto: pdfEur(s.importo_da_pagare),
      stato: STATO_SCADENZA_LABELS[s.stato],
      pagamento: s.data_pagamento ? `${pdfDate(s.data_pagamento)}${s.conto ? ` — ${s.conto.nome}` : ""}` : "—",
      mandato: s.mandato_numero ?? "—",
    }));
  }

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(filtrate.map((s) => ({
      Scadenza: s.data_scadenza, Tipo: TIPO_SCADENZA_LABELS[s.tipo], Beneficiario: s.beneficiario,
      "P.IVA": s.beneficiario_piva ?? "", Oggetto: s.descrizione, "N. documento": s.numero_documento ?? "",
      "Data documento": s.data_documento ?? "", Imponibile: Number(s.imponibile), IVA: Number(s.iva),
      "Split payment": s.split_payment ? "Sì" : "No", Ritenuta: Number(s.ritenuta),
      "Totale documento": Number(s.totale_documento), "Netto da pagare": Number(s.importo_da_pagare),
      CUP: s.cup, CIG: s.cig_esente ? `Non dovuto: ${s.cig_motivo_esenzione ?? ""}` : s.cig ?? "",
      Stato: STATO_SCADENZA_LABELS[s.stato], "Data pagamento": s.data_pagamento ?? "",
      Conto: s.conto?.nome ?? "", "CRO/TRN": s.cro_trn ?? "", Mandato: s.mandato_numero ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Scadenzario");
    XLSX.writeFile(wb, `Scadenzario_pagamenti_${oggiISO()}.xlsx`);
    toast.success("Excel esportato");
  }

  function exportPdf() {
    generateTablePdf(
      [
        { header: "Scadenza", dataKey: "scadenza" },
        { header: "Beneficiario", dataKey: "beneficiario" },
        { header: "Oggetto", dataKey: "descrizione" },
        { header: "Documento", dataKey: "documento" },
        { header: "CUP", dataKey: "cup" },
        { header: "CIG", dataKey: "cig" },
        { header: "Netto", dataKey: "netto", align: "right" },
        { header: "Stato", dataKey: "stato" },
        { header: "Pagamento", dataKey: "pagamento" },
      ],
      righeExport(),
      {
        title: "Scadenzario pagamenti",
        subtitle: `${filtrate.length} scadenze — totale netto ${pdfEur(totaleFiltrate)}`,
        galNome: currentGal?.nome,
        orientation: "landscape",
        filename: `Scadenzario_pagamenti_${oggiISO()}.pdf`,
        showSignatures: false,
      }
    );
    toast.success("PDF generato");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Scadenzario pagamenti</h1>
          <p className="text-sm text-gray-500">Fatture, F24 e pagamenti del GAL con verifica CUP/CIG e scheda per il mandato</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={() => navigate("/cash-flow")}><Landmark size={16} /> Cash flow</button>
          <button className="btn-secondary" onClick={exportExcel} disabled={!filtrate.length}><FileSpreadsheet size={16} /> Excel</button>
          <button className="btn-secondary" onClick={exportPdf} disabled={!filtrate.length}><FileDown size={16} /> PDF</button>
          {write && <button className="btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Nuova scadenza</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Scaduti" value={formatCurrency(kpi.scaduteTot)} subtitle={`${kpi.scaduteN} pagamenti`} icon={<AlertTriangle size={20} />} color="red" />
        <StatCard title="Entro 30 giorni" value={formatCurrency(kpi.entro30Tot)} subtitle={`${kpi.entro30N} pagamenti`} icon={<CalendarClock size={20} />} color="yellow" />
        <StatCard title="Totale da pagare" value={formatCurrency(kpi.aperteTot)} subtitle={`${kpi.aperteN} scadenze aperte`} icon={<Wallet size={20} />} color="blue" />
        <StatCard title="F24 da versare" value={formatCurrency(kpi.f24Tot)} subtitle={`${kpi.f24N} deleghe`} icon={<Receipt size={20} />} color="purple" />
        <StatCard title={`Pagato nel ${new Date().getFullYear()}`} value={formatCurrency(kpi.pagateTot)} icon={<CheckCircle2 size={20} />} color="green" />
      </div>

      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Cerca beneficiario, oggetto, CUP, CIG, mandato…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 border border-gray-200 rounded-lg p-0.5">
          {([["aperte", "Da pagare"], ["scadute", "Scaduti"], ["pagate", "Pagati"], ["tutte", "Tutti"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFiltroStato(k)}
              className={clsx("px-3 py-1.5 rounded-md text-sm", filtroStato === k ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")}>{l}</button>
          ))}
        </div>
        <select className="input w-auto" value={tipo} onChange={(e) => setTipo(e.target.value as TipoScadenzaPagamento | "")}>
          <option value="">Tutte le tipologie</option>
          {(Object.keys(TIPO_SCADENZA_LABELS) as TipoScadenzaPagamento[]).map((t) => <option key={t} value={t}>{TIPO_SCADENZA_LABELS[t]}</option>)}
        </select>
        {(filtroStato === "pagate" || filtroStato === "tutte") && (
          <select className="input w-auto" value={anno} onChange={(e) => setAnno(parseInt(e.target.value, 10))}>
            {anni.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={18} /> Caricamento scadenzario…</div>
        ) : filtrate.length === 0 ? (
          <div className="p-12 text-center text-gray-400">Nessuna scadenza per i filtri selezionati</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="table-header text-left">Scadenza</th>
                <th className="table-header text-left">Beneficiario / oggetto</th>
                <th className="table-header text-left">Documento</th>
                <th className="table-header text-left">CUP / CIG</th>
                <th className="table-header text-right">Netto da pagare</th>
                <th className="table-header text-left">Stato</th>
                <th className="table-header text-left">Pagamento</th>
              </tr>
            </thead>
            <tbody>
              {filtrate.map((s) => {
                const et = etichettaScadenza(s.data_scadenza);
                const traccOk = s.cup && (s.cig_esente || s.cig) && (s.tipo === "f24" || s.cup_in_fattura) && (s.cig_esente || s.tipo === "f24" || s.cig_in_fattura);
                return (
                  <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/scadenzario/${s.id}`)}>
                    <td className="table-cell whitespace-nowrap">
                      <div>{formatDate(s.data_scadenza)}</div>
                      {scadenzaAperta(s) && <div className={clsx("text-xs", et.classe)}>{et.testo}</div>}
                    </td>
                    <td className="table-cell">
                      <div className="font-medium text-gray-900 flex items-center gap-1.5">
                        {s.tipo === "f24" && <span className="badge bg-purple-100 text-purple-700">F24</span>}
                        {s.beneficiario}
                      </div>
                      <div className="text-xs text-gray-500 max-w-md truncate">{s.descrizione}</div>
                    </td>
                    <td className="table-cell text-xs whitespace-nowrap">
                      {s.numero_documento ? <>n. {s.numero_documento}<br /><span className="text-gray-400">{formatDate(s.data_documento)}</span></> : <span className="text-gray-400">—</span>}
                      {s.fattura_path && <Paperclip size={12} className="inline ml-1 text-gray-400" />}
                    </td>
                    <td className="table-cell text-xs">
                      <div className="flex items-center gap-1.5">
                        {traccOk ? <ShieldCheck size={14} className="text-green-600" /> : <ShieldAlert size={14} className="text-amber-500" />}
                        <div className="font-mono">
                          <div>{s.cup}</div>
                          <div className="text-gray-400">{s.cig_esente ? "CIG n.d." : s.cig}</div>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell text-right font-semibold whitespace-nowrap">
                      {formatCurrency(s.importo_da_pagare)}
                      {(s.ritenuta > 0 || s.split_payment) && <div className="text-[11px] font-normal text-gray-400">tot. doc. {formatCurrency(s.totale_documento)}</div>}
                    </td>
                    <td className="table-cell"><span className={clsx("badge", STATO_SCADENZA_COLORS[s.stato])}>{STATO_SCADENZA_LABELS[s.stato]}</span></td>
                    <td className="table-cell text-xs">
                      {s.data_pagamento ? (
                        <>
                          <div>{formatDate(s.data_pagamento)}</div>
                          <div className="text-gray-400">{s.conto?.nome ?? ""}{s.mandato_numero ? ` · Mand. ${s.mandato_numero}` : ""}</div>
                        </>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td className="table-cell" colSpan={4}>Totale ({filtrate.length})</td>
                <td className="table-cell text-right">{formatCurrency(totaleFiltrate)}</td>
                <td className="table-cell" colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {currentGal && (
        <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuova scadenza di pagamento" size="xl">
          <ScadenzaForm galId={currentGal.id} modalita="crea" initial={scadenzaFormVuota()} onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
        </Modal>
      )}
    </div>
  );
}
