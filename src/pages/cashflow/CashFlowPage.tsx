// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import clsx from "clsx";
import * as XLSX from "xlsx";
import {
  Wallet, TrendingDown, TrendingUp, AlertTriangle, CheckCircle2, Loader2, FileSpreadsheet, FileDown,
} from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate } from "../../lib/utils";
import { generateMultiSectionPdf, pdfEur } from "../../lib/pdf";
import {
  analisiMensile, costruisciFlussi, liquiditaAttuale, previstoEntro, primaTensione, saldiConti,
} from "../../lib/cashflow";
import { oggiISO, round2 } from "../../lib/scadenze";
import { MESI_BREVI, TIPO_SCADENZA_LABELS, categoriaMovimentoLabel } from "../../constants";
import StatCard from "../../components/ui/StatCard";
import ContiTab from "../../components/cashflow/ContiTab";
import MovimentiTab from "../../components/cashflow/MovimentiTab";
import type { ContoCorrente, MovimentoCassa, ScadenzaPagamento, TipoScadenzaPagamento } from "../../types";

type Tab = "analisi" | "movimenti" | "conti";

export default function CashFlowPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [tab, setTab] = useState<Tab>("analisi");
  const [anno, setAnno] = useState(new Date().getFullYear());
  const [conti, setConti] = useState<ContoCorrente[]>([]);
  const [scadenze, setScadenze] = useState<ScadenzaPagamento[]>([]);
  const [movimenti, setMovimenti] = useState<MovimentoCassa[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!currentGal) return;
    const [cRes, sRes, mRes] = await Promise.all([
      supabase.from("gal_conti").select("*").eq("gal_id", currentGal.id).order("nome"),
      supabase.from("gal_scadenze_pagamento").select("*").eq("gal_id", currentGal.id),
      supabase.from("gal_movimenti_cassa").select("*").eq("gal_id", currentGal.id),
    ]);
    if (cRes.error || sRes.error || mRes.error) {
      console.error(cRes.error, sRes.error, mRes.error);
      toast.error("Impossibile caricare i dati di cassa. Verifica che l'aggiornamento del database 4.0 sia stato eseguito.");
    }
    setConti((cRes.data ?? []) as ContoCorrente[]);
    setScadenze((sRes.data ?? []) as ScadenzaPagamento[]);
    setMovimenti((mRes.data ?? []) as MovimentoCassa[]);
    setLoading(false);
  }

  useEffect(() => { setLoading(true); load(); }, [currentGal?.id]);

  const flussi = useMemo(() => costruisciFlussi(scadenze, movimenti), [scadenze, movimenti]);
  const saldi = useMemo(() => saldiConti(conti, flussi), [conti, flussi]);
  const liquidita = useMemo(() => liquiditaAttuale(conti, flussi), [conti, flussi]);
  const mesi = useMemo(() => analisiMensile(anno, flussi, liquidita), [anno, flussi, liquidita]);
  const p30 = useMemo(() => previstoEntro(flussi, 30), [flussi]);
  const p90 = useMemo(() => previstoEntro(flussi, 90), [flussi]);
  const tensione = useMemo(() => primaTensione(flussi, liquidita), [flussi, liquidita]);

  const anni = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear()]);
    flussi.forEach((f) => s.add(parseInt(f.data.slice(0, 4), 10)));
    return [...s].sort((a, b) => b - a);
  }, [flussi]);

  const datiGrafico = mesi.map((m) => ({
    mese: MESI_BREVI[m.mese],
    "Entrate": m.entrateRealizzate,
    "Entrate previste": m.entratePreviste,
    "Uscite": -m.usciteRealizzate,
    "Uscite previste": -m.uscitePreviste,
    "Saldo fine mese": m.saldoFineMese,
  }));

  const totAnno = mesi.reduce((t, m) => ({
    er: t.er + m.entrateRealizzate, ur: t.ur + m.usciteRealizzate, ep: t.ep + m.entratePreviste, up: t.up + m.uscitePreviste,
  }), { er: 0, ur: 0, ep: 0, up: 0 });

  // Composizione uscite pagate nell'anno per tipologia ed entrate per categoria
  const usciteTipo = useMemo(() => {
    const m = new Map<TipoScadenzaPagamento, number>();
    scadenze.filter((s) => s.stato === "pagata" && (s.data_pagamento ?? "").startsWith(String(anno)))
      .forEach((s) => m.set(s.tipo, (m.get(s.tipo) ?? 0) + Number(s.importo_pagato ?? s.importo_da_pagare)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [scadenze, anno]);
  const entrateCat = useMemo(() => {
    const m = new Map<string, number>();
    movimenti.filter((x) => x.tipo === "entrata" && x.stato === "realizzato" && (x.data_effettiva ?? "").startsWith(String(anno)))
      .forEach((x) => m.set(x.categoria, (m.get(x.categoria) ?? 0) + Number(x.importo)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [movimenti, anno]);

  const prossime = useMemo(() => flussi
    .filter((f) => !f.realizzato)
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, 10), [flussi]);

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(mesi.map((m) => ({
      Mese: MESI_BREVI[m.mese], "Entrate realizzate": m.entrateRealizzate, "Uscite realizzate": m.usciteRealizzate,
      "Entrate previste": m.entratePreviste, "Uscite previste": m.uscitePreviste, "Saldo fine mese": m.saldoFineMese,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Cash flow ${anno}`);
    XLSX.writeFile(wb, `Cash_flow_${anno}.xlsx`);
    toast.success("Excel esportato");
  }

  function exportPdf() {
    generateMultiSectionPdf([
      {
        title: "Situazione di liquidità",
        columns: [{ header: "Conto", dataKey: "conto" }, { header: "Saldo attuale", dataKey: "saldo" }],
        rows: conti.filter((c) => c.attivo).map((c) => ({ conto: `${c.nome}${c.banca ? ` — ${c.banca}` : ""}`, saldo: pdfEur(saldi.get(c.id) ?? 0) })),
        summary: [
          { label: "Liquidità attuale", value: pdfEur(liquidita) },
          { label: "Uscite previste a 90 gg", value: pdfEur(p90.uscite) },
          { label: "Entrate previste a 90 gg", value: pdfEur(p90.entrate) },
          { label: "Saldo previsto a 90 gg", value: pdfEur(round2(liquidita + p90.entrate - p90.uscite)) },
        ],
      },
      {
        title: `Andamento mensile ${anno}`,
        columns: [
          { header: "Mese", dataKey: "mese" }, { header: "Entrate", dataKey: "er" }, { header: "Uscite", dataKey: "ur" },
          { header: "Entrate prev.", dataKey: "ep" }, { header: "Uscite prev.", dataKey: "up" }, { header: "Saldo fine mese", dataKey: "saldo" },
        ],
        rows: mesi.map((m) => ({
          mese: MESI_BREVI[m.mese], er: pdfEur(m.entrateRealizzate), ur: pdfEur(m.usciteRealizzate),
          ep: pdfEur(m.entratePreviste), up: pdfEur(m.uscitePreviste), saldo: pdfEur(m.saldoFineMese),
        })),
      },
    ], {
      title: `Cash flow ${anno}`,
      subtitle: `Situazione al ${formatDate(oggiISO())}`,
      galNome: currentGal?.nome,
      filename: `Cash_flow_${anno}.pdf`,
      showSignatures: false,
    });
    toast.success("PDF generato");
  }

  if (!currentGal) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Cash flow</h1>
          <p className="text-sm text-gray-500">Incassi, pagamenti e liquidità del GAL — realizzato e previsto</p>
        </div>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {([["analisi", "Analisi"], ["movimenti", "Incassi e movimenti"], ["conti", "Conti"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={clsx("px-3 py-1.5 rounded-md text-sm font-medium", tab === k ? "bg-primary-600 text-white" : "text-gray-600 hover:bg-gray-100")}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card p-12 flex items-center justify-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={18} /> Caricamento…</div>
      ) : tab === "conti" ? (
        <ContiTab galId={currentGal.id} conti={conti} saldi={saldi} write={write} onChange={load} />
      ) : tab === "movimenti" ? (
        <MovimentiTab galId={currentGal.id} movimenti={movimenti} conti={conti} write={write} admin={isAdmin(user)} onChange={load} />
      ) : (
        <>
          {conti.length === 0 && (
            <div className="card p-3 text-sm text-amber-800 bg-amber-50 border-amber-200 flex items-center justify-between gap-3">
              <span>Per calcolare la liquidità configura prima i conti del GAL con il saldo iniziale.</span>
              <button className="btn-secondary py-1" onClick={() => setTab("conti")}>Configura conti</button>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Liquidità attuale" value={formatCurrency(liquidita)} subtitle={`${conti.filter((c) => c.attivo).length} conti attivi`} icon={<Wallet size={20} />} color={liquidita < 0 ? "red" : "blue"} />
            <StatCard title="Uscite entro 30 gg" value={formatCurrency(p30.uscite)} subtitle={`a 90 gg: ${formatCurrency(p90.uscite)}`} icon={<TrendingDown size={20} />} color="yellow" />
            <StatCard title="Entrate entro 90 gg" value={formatCurrency(p90.entrate)} subtitle={`a 30 gg: ${formatCurrency(p30.entrate)}`} icon={<TrendingUp size={20} />} color="green" />
            <StatCard title="Saldo previsto a 90 gg" value={formatCurrency(liquidita + p90.entrate - p90.uscite)} icon={<Wallet size={20} />} color={liquidita + p90.entrate - p90.uscite < 0 ? "red" : "purple"} />
          </div>

          {tensione ? (
            <div className="card p-3 flex items-center gap-3 bg-red-50 border-red-200 text-sm text-red-800">
              <AlertTriangle size={18} />
              Attenzione: con i pagamenti e incassi previsti la liquidità diventa negativa il <strong>{formatDate(tensione.data)}</strong> ({formatCurrency(tensione.saldo)}).
              Valuta anticipi, solleciti di erogazione o il differimento dei pagamenti non urgenti.
            </div>
          ) : (
            <div className="card p-3 flex items-center gap-3 bg-green-50 border-green-200 text-sm text-green-800">
              <CheckCircle2 size={18} /> Nessuna tensione di cassa prevista nei prossimi 6 mesi.
            </div>
          )}

          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="font-semibold text-gray-900">Andamento mensile</h2>
              <div className="flex gap-2">
                <select className="input w-auto py-1" value={anno} onChange={(e) => setAnno(parseInt(e.target.value, 10))}>
                  {anni.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <button className="btn-secondary py-1" onClick={exportExcel}><FileSpreadsheet size={15} /> Excel</button>
                <button className="btn-secondary py-1" onClick={exportPdf}><FileDown size={15} /> PDF</button>
              </div>
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={datiGrafico} stackOffset="sign" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="mese" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))} />
                  <Tooltip formatter={(v) => formatCurrency(Math.abs(Number(v)))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine y={0} stroke="#9ca3af" />
                  <Bar dataKey="Entrate" stackId="e" fill="#16a34a" />
                  <Bar dataKey="Entrate previste" stackId="e" fill="#86efac" />
                  <Bar dataKey="Uscite" stackId="e" fill="#dc2626" />
                  <Bar dataKey="Uscite previste" stackId="e" fill="#fca5a5" />
                  <Line type="monotone" dataKey="Saldo fine mese" stroke="#1e3a8a" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="table-header text-left">Mese</th>
                    <th className="table-header text-right">Entrate</th>
                    <th className="table-header text-right">Uscite</th>
                    <th className="table-header text-right">Entrate prev.</th>
                    <th className="table-header text-right">Uscite prev.</th>
                    <th className="table-header text-right">Saldo fine mese</th>
                  </tr>
                </thead>
                <tbody>
                  {mesi.map((m) => (
                    <tr key={m.mese} className={clsx("border-b border-gray-100", m.futuro && "bg-blue-50/30")}>
                      <td className="table-cell py-2">{MESI_BREVI[m.mese]}</td>
                      <td className="table-cell py-2 text-right text-green-700">{m.entrateRealizzate ? formatCurrency(m.entrateRealizzate) : "—"}</td>
                      <td className="table-cell py-2 text-right text-red-600">{m.usciteRealizzate ? formatCurrency(m.usciteRealizzate) : "—"}</td>
                      <td className="table-cell py-2 text-right text-green-600/70">{m.entratePreviste ? formatCurrency(m.entratePreviste) : "—"}</td>
                      <td className="table-cell py-2 text-right text-red-500/70">{m.uscitePreviste ? formatCurrency(m.uscitePreviste) : "—"}</td>
                      <td className={clsx("table-cell py-2 text-right font-semibold", m.saldoFineMese < 0 && "text-red-600")}>{formatCurrency(m.saldoFineMese)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-semibold">
                    <td className="table-cell py-2">Totale {anno}</td>
                    <td className="table-cell py-2 text-right">{formatCurrency(totAnno.er)}</td>
                    <td className="table-cell py-2 text-right">{formatCurrency(totAnno.ur)}</td>
                    <td className="table-cell py-2 text-right">{formatCurrency(totAnno.ep)}</td>
                    <td className="table-cell py-2 text-right">{formatCurrency(totAnno.up)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="card p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Prossimi movimenti previsti</h3>
              {prossime.length === 0 ? <p className="text-sm text-gray-400">Nessun movimento previsto</p> : (
                <ul className="space-y-2 text-sm">
                  {prossime.map((f, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="min-w-0">
                        <span className="text-xs text-gray-400 mr-2">{formatDate(f.data)}</span>
                        <span className="truncate">{f.descrizione}</span>
                      </span>
                      <span className={clsx("font-medium whitespace-nowrap", f.importo > 0 ? "text-green-700" : "text-red-600")}>
                        {f.importo > 0 ? "+" : "−"} {formatCurrency(Math.abs(f.importo))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <button className="text-xs text-primary-700 hover:underline mt-3" onClick={() => navigate("/scadenzario")}>Vai allo scadenzario →</button>
            </div>
            <Composizione titolo={`Pagamenti ${anno} per tipologia`} righe={usciteTipo.map(([k, v]) => [TIPO_SCADENZA_LABELS[k], v])} colore="bg-red-400" />
            <Composizione titolo={`Incassi ${anno} per fonte`} righe={entrateCat.map(([k, v]) => [categoriaMovimentoLabel(k), v])} colore="bg-green-500" />
          </div>
        </>
      )}
    </div>
  );
}

function Composizione({ titolo, righe, colore }: { titolo: string; righe: [string, number][]; colore: string }) {
  const tot = righe.reduce((t, [, v]) => t + v, 0);
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{titolo}</h3>
      {righe.length === 0 ? <p className="text-sm text-gray-400">Nessun dato</p> : (
        <ul className="space-y-2.5 text-sm">
          {righe.map(([label, v]) => (
            <li key={label}>
              <div className="flex justify-between gap-2"><span className="truncate">{label}</span><span className="font-medium">{formatCurrency(v)}</span></div>
              <div className="h-1.5 bg-gray-100 rounded-full mt-1"><div className={clsx("h-full rounded-full", colore)} style={{ width: `${tot ? (v / tot) * 100 : 0}%` }} /></div>
            </li>
          ))}
          <li className="flex justify-between pt-2 border-t font-semibold"><span>Totale</span><span>{formatCurrency(tot)}</span></li>
        </ul>
      )}
    </div>
  );
}
