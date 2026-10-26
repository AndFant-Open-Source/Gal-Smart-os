// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate } from "../../lib/utils";
import {
  BarChart3, FileText, TrendingUp, CheckCircle2, AlertCircle, Activity,
  Users, Landmark, Euro, Receipt, ShoppingCart, AlertTriangle,
  PieChart as PieChartIcon, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  Palette                                                            */
/* ------------------------------------------------------------------ */
const GREEN = ["#166534", "#15803d", "#16a34a", "#22c55e", "#4ade80", "#86efac"];
const STATUS_COLORS: Record<string, string> = {
  da_pagare: "#eab308",
  pagata: "#16a34a",
  parzialmente_pagata: "#3b82f6",
  annullata: "#ef4444",
};
const CHART_COLORS = ["#166534", "#2563eb", "#eab308", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899"];

/* ------------------------------------------------------------------ */
/*  Row types (no `any`)                                               */
/* ------------------------------------------------------------------ */
interface BandoRow { stato: string; dotazione_finanziaria: number | null }
interface DomandaRow { stato: string; contributo_concesso: number | null }
interface GiustRow { id: string; stato: string; imponibile: number | null; iva: number | null; totale: number | null }
interface PagGiustRow { giustificativo_id: string; importo: number | null }
interface RigaImputRow { giustificativo_id: string; misura: string; totale_imputato: number | null; imponibile_imputato: number | null }
interface ProceduraRow { stato: string; importo_stimato: number | null; importo_aggiudicato: number | null; cig: string | null }
interface SocioRow { tipo_socio: string; attivo: boolean }
interface SedutaRow { data_seduta: string }
interface ChartEntry { name: string; value: number }
interface BarEntry { name: string; [key: string]: string | number }

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
interface ReportState {
  /* KPI */
  bandiTotale: number; bandiAperti: number; dotazione: number;
  domandeTotale: number; domandeFinanziate: number; contributo: number;
  giustTotale: number; giustImporto: number;
  procTotale: number; procImporto: number;
  sociTotale: number;
  /* Rendicontazione */
  totaleSostenuto: number; totalePagato: number; daPagare: number;
  contributoRichiesto: number;
  giustByStato: ChartEntry[];
  misureSostenutoRichiesto: BarEntry[];
  /* Bandi & Domande */
  bandiByStato: ChartEntry[];
  domandeByStato: ChartEntry[];
  finanziatePct: number;
  /* Procedure */
  procByStato: ChartEntry[];
  procSenzaCig: number;
  /* Organi */
  sociByTipo: ChartEntry[];
  sociAttivi: number;
  seduteTotale: number;
  ultimaSeduta: string | null;
  /* Alerts */
  giustDaPagare: number;
}

const EMPTY: ReportState = {
  bandiTotale: 0, bandiAperti: 0, dotazione: 0,
  domandeTotale: 0, domandeFinanziate: 0, contributo: 0,
  giustTotale: 0, giustImporto: 0,
  procTotale: 0, procImporto: 0,
  sociTotale: 0,
  totaleSostenuto: 0, totalePagato: 0, daPagare: 0, contributoRichiesto: 0,
  giustByStato: [], misureSostenutoRichiesto: [],
  bandiByStato: [], domandeByStato: [], finanziatePct: 0,
  procByStato: [], procSenzaCig: 0,
  sociByTipo: [], sociAttivi: 0,
  seduteTotale: 0, ultimaSeduta: null,
  giustDaPagare: 0,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function groupCount(arr: { stato: string }[]): ChartEntry[] {
  const m: Record<string, number> = {};
  for (const r of arr) m[r.stato] = (m[r.stato] ?? 0) + 1;
  return Object.entries(m).map(([name, value]) => ({ name, value }));
}
function n(v: number | null | undefined): number { return v ?? 0; }

const STATO_LABELS: Record<string, string> = {
  da_pagare: "Da pagare", pagata: "Pagata", parzialmente_pagata: "Parz. pagata", annullata: "Annullata",
  aperto: "Aperto", chiuso: "Chiuso", in_valutazione: "In valutazione", sospeso: "Sospeso",
  presentata: "Presentata", ammessa: "Ammessa", finanziata: "Finanziata", liquidata: "Liquidata",
  non_ammessa: "Non ammessa", rinuncia: "Rinuncia", revocata: "Revocata", decaduta: "Decaduta",
  fabbisogno: "Fabbisogno", determina: "Determina", scelta_procedura: "Scelta proc.",
  preventivi_inviti: "Preventivi", affidamento: "Affidamento", contratto: "Contratto",
  esecuzione: "Esecuzione", pagamenti: "Pagamenti", trasparenza: "Trasparenza",
};
function labelStato(s: string): string { return STATO_LABELS[s] ?? s; }

/* ------------------------------------------------------------------ */
/*  Custom tooltip                                                     */
/* ------------------------------------------------------------------ */
function CurrencyTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 shadow-lg rounded-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {formatCurrency(p.value)}</p>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  COMPONENT                                                          */
/* ================================================================== */
export default function ReportPage() {
  const currentGal = useGalStore((s) => s.currentGal);
  const [rpt, setRpt] = useState<ReportState>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentGal) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGal?.id]);

  async function loadAll() {
    if (!currentGal) return;
    setLoading(true);

    try {
      /* ---------- parallel queries ---------- */
      const [
        { data: bandi },
        { data: domande },
        { data: giust },
        { data: procedure },
        { data: soci },
        { data: sedute },
      ] = await Promise.all([
        supabase.from("gal_bandi").select("stato, dotazione_finanziaria").eq("gal_id", currentGal.id),
        supabase.from("gal_domande_sostegno").select("stato, contributo_concesso").eq("gal_id", currentGal.id),
        supabase.from("gal_giustificativi").select("id, stato, imponibile, iva, totale").eq("gal_id", currentGal.id),
        supabase.from("gal_procedure").select("stato, importo_stimato, importo_aggiudicato, cig").eq("gal_id", currentGal.id),
        supabase.from("gal_soci").select("tipo_socio, attivo").eq("gal_id", currentGal.id),
        supabase.from("gal_sedute").select("data_seduta").eq("gal_id", currentGal.id).order("data_seduta", { ascending: false }),
      ]);

      const bandiArr = (bandi ?? []) as BandoRow[];
      const domandeArr = (domande ?? []) as DomandaRow[];
      const giustArr = (giust ?? []) as GiustRow[];
      const procArr = (procedure ?? []) as ProceduraRow[];
      const sociArr = (soci ?? []) as SocioRow[];
      const seduteArr = (sedute ?? []) as SedutaRow[];

      /* ---------- Pagamenti & Righe (dependent on giust IDs) ---------- */
      const giustIds = giustArr.map((g) => g.id);
      let pagArr: PagGiustRow[] = [];
      let righeArr: RigaImputRow[] = [];

      if (giustIds.length > 0) {
        const batchSize = 200;
        const pagBatches: PagGiustRow[][] = [];
        const righeBatches: RigaImputRow[][] = [];

        for (let i = 0; i < giustIds.length; i += batchSize) {
          const slice = giustIds.slice(i, i + batchSize);
          const [{ data: pag }, { data: righe }] = await Promise.all([
            supabase.from("gal_pagamenti_giust").select("giustificativo_id, importo").in("giustificativo_id", slice),
            supabase.from("gal_righe_imputazione").select("giustificativo_id, misura, totale_imputato, imponibile_imputato").in("giustificativo_id", slice),
          ]);
          pagBatches.push((pag ?? []) as PagGiustRow[]);
          righeBatches.push((righe ?? []) as RigaImputRow[]);
        }
        pagArr = pagBatches.flat();
        righeArr = righeBatches.flat();
      }

      /* ---------- Compute ---------- */
      const totaleSostenuto = giustArr.reduce((s, g) => s + n(g.totale), 0);
      const totalePagato = pagArr.reduce((s, p) => s + n(p.importo), 0);
      const daPagareAmt = totaleSostenuto - totalePagato;

      // Contributo richiesto from righe (totale_imputato where eleggibile - we sum totale_imputato)
      const contributoRichiesto = righeArr.reduce((s, r) => s + n(r.totale_imputato), 0);

      // Misure aggregation
      const misureMap: Record<string, { sostenuto: number; richiesto: number }> = {};
      for (const r of righeArr) {
        const key = r.misura || "N/D";
        if (!misureMap[key]) misureMap[key] = { sostenuto: 0, richiesto: 0 };
        misureMap[key].sostenuto += n(r.imponibile_imputato) + n(r.totale_imputato) - n(r.imponibile_imputato);
        misureMap[key].richiesto += n(r.totale_imputato);
      }
      const misureSostenutoRichiesto: BarEntry[] = Object.entries(misureMap)
        .sort((a, b) => b[1].sostenuto - a[1].sostenuto)
        .slice(0, 12)
        .map(([name, v]) => ({ name, Sostenuto: v.sostenuto, Richiesto: v.richiesto }));

      // Giust by stato
      const giustByStato = groupCount(giustArr);

      // Bandi
      const dotazione = bandiArr.reduce((s, b) => s + n(b.dotazione_finanziaria), 0);
      const bandiAperti = bandiArr.filter((b) => b.stato === "aperto").length;

      // Domande
      const domandeFinanziate = domandeArr.filter((d) => d.stato === "finanziata" || d.stato === "liquidata").length;
      const contributo = domandeArr.reduce((s, d) => s + n(d.contributo_concesso), 0);
      const finanziatePct = domandeArr.length > 0 ? (domandeFinanziate / domandeArr.length) * 100 : 0;

      // Procedure
      const procSenzaCig = procArr.filter((p) => !p.cig && p.stato !== "fabbisogno").length;
      const procImporto = procArr.reduce((s, p) => s + n(p.importo_stimato), 0);

      // Soci
      const sociAttivi = sociArr.filter((s) => s.attivo).length;
      const sociByTipoMap: Record<string, number> = {};
      for (const s of sociArr) {
        sociByTipoMap[s.tipo_socio] = (sociByTipoMap[s.tipo_socio] ?? 0) + 1;
      }
      const sociByTipo = Object.entries(sociByTipoMap).map(([name, value]) => ({ name, value }));

      // Sedute
      const ultimaSeduta = seduteArr.length > 0 ? seduteArr[0].data_seduta : null;

      setRpt({
        bandiTotale: bandiArr.length, bandiAperti, dotazione,
        domandeTotale: domandeArr.length, domandeFinanziate, contributo,
        giustTotale: giustArr.length, giustImporto: totaleSostenuto,
        procTotale: procArr.length, procImporto,
        sociTotale: sociArr.length,
        totaleSostenuto, totalePagato, daPagare: daPagareAmt, contributoRichiesto,
        giustByStato, misureSostenutoRichiesto,
        bandiByStato: groupCount(bandiArr), domandeByStato: groupCount(domandeArr), finanziatePct,
        procByStato: groupCount(procArr), procSenzaCig,
        sociByTipo, sociAttivi,
        seduteTotale: seduteArr.length, ultimaSeduta,
        giustDaPagare: giustArr.filter((g) => g.stato === "da_pagare").length,
      });
    } catch (err) {
      console.error("Report load error", err);
    } finally {
      setLoading(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Loading / empty                                                  */
  /* ---------------------------------------------------------------- */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700" />
        <span className="ml-3 text-gray-500">Caricamento report...</span>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  const alerts: { text: string; severity: "warn" | "error" }[] = [];
  if (rpt.giustDaPagare > 0) alerts.push({ text: `${rpt.giustDaPagare} giustificativi ancora da pagare`, severity: "warn" });
  if (rpt.procSenzaCig > 0) alerts.push({ text: `${rpt.procSenzaCig} procedure senza CIG assegnato`, severity: "error" });
  if (rpt.daPagare > 0) alerts.push({ text: `Importo residuo da pagare: ${formatCurrency(rpt.daPagare)}`, severity: "warn" });

  return (
    <div className="space-y-6 pb-8">
      {/* ============================================================ */}
      {/* HEADER                                                       */}
      {/* ============================================================ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart3 className="text-green-700" size={24} />
            Report Generale
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {currentGal?.nome} &mdash; Aggiornato al {today}
          </p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* EXECUTIVE KPI BAR  (6 cards)                                  */}
      {/* ============================================================ */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard icon={<Landmark size={18} />} label="Bandi" value={rpt.bandiTotale}
          sub={`${rpt.bandiAperti} aperti`} color="green" />
        <KpiCard icon={<FileText size={18} />} label="Domande" value={rpt.domandeTotale}
          sub={`${rpt.domandeFinanziate} finanziate`} color="blue" />
        <KpiCard icon={<Euro size={18} />} label="Dotazione" value={formatCurrency(rpt.dotazione)}
          sub="Finanziaria totale" color="emerald" />
        <KpiCard icon={<Receipt size={18} />} label="Giustificativi" value={rpt.giustTotale}
          sub={formatCurrency(rpt.giustImporto)} color="yellow" />
        <KpiCard icon={<ShoppingCart size={18} />} label="Procedure" value={rpt.procTotale}
          sub={formatCurrency(rpt.procImporto)} color="purple" />
        <KpiCard icon={<Users size={18} />} label="Soci" value={rpt.sociTotale}
          sub={`${rpt.sociAttivi} attivi`} color="cyan" />
      </div>

      {/* ============================================================ */}
      {/* RENDICONTAZIONE SECTION                                       */}
      {/* ============================================================ */}
      <Section title="Rendicontazione" icon={<TrendingUp size={16} />}>
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MiniCard label="Totale Sostenuto" value={formatCurrency(rpt.totaleSostenuto)}
            icon={<ArrowUpRight size={14} className="text-green-600" />} />
          <MiniCard label="Totale Pagato" value={formatCurrency(rpt.totalePagato)}
            icon={<CheckCircle2 size={14} className="text-blue-600" />} />
          <MiniCard label="Da Pagare" value={formatCurrency(rpt.daPagare)}
            icon={rpt.daPagare > 0 ? <ArrowDownRight size={14} className="text-yellow-600" /> : <Minus size={14} className="text-gray-400" />}
            highlight={rpt.daPagare > 0} />
          <MiniCard label="Contributo Richiesto" value={formatCurrency(rpt.contributoRichiesto)}
            icon={<Euro size={14} className="text-purple-600" />} />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pie: giust by stato */}
          <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <PieChartIcon size={14} className="text-green-700" /> Giustificativi per stato
            </h4>
            {rpt.giustByStato.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={rpt.giustByStato.map((e) => ({ ...e, name: labelStato(e.name) }))}
                    cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value">
                    {rpt.giustByStato.map((e, i) => (
                      <Cell key={i} fill={STATUS_COLORS[e.name] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>

          {/* Bar: misure sostenuto vs richiesto */}
          <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <BarChart3 size={14} className="text-green-700" /> Importi per Misura
            </h4>
            {rpt.misureSostenutoRichiesto.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={rpt.misureSostenutoRichiesto} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Sostenuto" fill="#166534" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Richiesto" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/* BANDI & DOMANDE SECTION                                       */}
      {/* ============================================================ */}
      <Section title="Bandi & Domande" icon={<Landmark size={16} />}>
        {/* Top info strip */}
        <div className="flex flex-wrap gap-4 mb-4 text-sm">
          <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-800 px-3 py-1 rounded-full font-medium">
            <Euro size={13} /> Dotazione: {formatCurrency(rpt.dotazione)}
          </span>
          <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-800 px-3 py-1 rounded-full font-medium">
            <FileText size={13} /> Contributo concesso: {formatCurrency(rpt.contributo)}
          </span>
          <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 px-3 py-1 rounded-full font-medium">
            <CheckCircle2 size={13} /> Finanziate: {rpt.finanziatePct.toFixed(1)}%
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pie: bandi by stato */}
          <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <PieChartIcon size={14} className="text-green-700" /> Bandi per stato
            </h4>
            {rpt.bandiByStato.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={rpt.bandiByStato.map((e) => ({ ...e, name: labelStato(e.name) }))}
                    cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value">
                    {rpt.bandiByStato.map((_, i) => <Cell key={i} fill={GREEN[i % GREEN.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>

          {/* Bar: domande by stato */}
          <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <FileText size={14} className="text-blue-700" /> Domande per stato
            </h4>
            {rpt.domandeByStato.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={rpt.domandeByStato.map((e) => ({ ...e, name: labelStato(e.name) }))} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#166534" name="Domande" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/* PROCEDURE SECTION                                             */}
      {/* ============================================================ */}
      <Section title="Procedure di Acquisto" icon={<ShoppingCart size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Bar: procedure by stato */}
          <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Activity size={14} className="text-purple-700" /> Procedure per stato
            </h4>
            {rpt.procByStato.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={rpt.procByStato.map((e) => ({ ...e, name: labelStato(e.name) }))} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#7c3aed" name="Procedure" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>

          {/* Info panel */}
          <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Riepilogo Procedure</h4>
            <div className="grid grid-cols-2 gap-3">
              <StatBlock label="Totale procedure" value={String(rpt.procTotale)} />
              <StatBlock label="Importo stimato" value={formatCurrency(rpt.procImporto)} />
            </div>
            {rpt.procSenzaCig > 0 && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
                <span><strong>{rpt.procSenzaCig}</strong> procedure senza CIG assegnato (escluse quelle in stato fabbisogno)</span>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/* ORGANI SOCIALI SECTION                                        */}
      {/* ============================================================ */}
      <Section title="Organi Sociali" icon={<Users size={16} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Soci by tipo */}
          <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <PieChartIcon size={14} className="text-cyan-700" /> Soci per tipo
            </h4>
            {rpt.sociByTipo.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={rpt.sociByTipo} cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={3} dataKey="value">
                    {rpt.sociByTipo.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyChart />}
          </div>

          {/* Sedute & summary */}
          <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm space-y-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Riepilogo</h4>
            <div className="grid grid-cols-2 gap-3">
              <StatBlock label="Soci totali" value={String(rpt.sociTotale)} />
              <StatBlock label="Soci attivi" value={String(rpt.sociAttivi)} />
              <StatBlock label="Sedute totali" value={String(rpt.seduteTotale)} />
              <StatBlock label="Ultima seduta" value={rpt.ultimaSeduta ? formatDate(rpt.ultimaSeduta) : "N/D"} />
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================================ */}
      {/* ALERTS SECTION                                                */}
      {/* ============================================================ */}
      {alerts.length > 0 ? (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5 space-y-2">
          <h3 className="text-sm font-bold text-yellow-800 flex items-center gap-2 mb-2">
            <AlertCircle size={16} /> Segnalazioni
          </h3>
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-2 text-sm ${a.severity === "error" ? "text-red-700" : "text-yellow-800"}`}>
              {a.severity === "error"
                ? <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
                : <AlertCircle size={14} className="text-yellow-600 mt-0.5 shrink-0" />}
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-center gap-2 text-sm text-green-800 font-medium">
          <CheckCircle2 size={16} className="text-green-600" /> Nessuna criticita rilevata. Tutti i dati sono regolari.
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  SUB-COMPONENTS                                                     */
/* ================================================================== */

const COLOR_MAP: Record<string, { border: string; iconBg: string; icon: string }> = {
  green:   { border: "border-green-500",   iconBg: "bg-green-100",   icon: "text-green-700" },
  blue:    { border: "border-blue-500",    iconBg: "bg-blue-100",    icon: "text-blue-700" },
  emerald: { border: "border-emerald-500", iconBg: "bg-emerald-100", icon: "text-emerald-700" },
  yellow:  { border: "border-yellow-500",  iconBg: "bg-yellow-100",  icon: "text-yellow-700" },
  purple:  { border: "border-purple-500",  iconBg: "bg-purple-100",  icon: "text-purple-700" },
  cyan:    { border: "border-cyan-500",    iconBg: "bg-cyan-100",    icon: "text-cyan-700" },
};

function KpiCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub: string; color: string;
}) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.green;
  return (
    <div className={`bg-white rounded-xl shadow-sm border-l-4 ${c.border} p-4 flex flex-col justify-between min-h-[100px]`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`${c.iconBg} ${c.icon} rounded-lg p-1.5`}>{icon}</div>
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 leading-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  );
}

function MiniCard({ label, value, icon, highlight }: {
  label: string; value: string; icon: React.ReactNode; highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-yellow-50 border-yellow-200" : "bg-gray-50 border-gray-100"}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className={`text-sm font-bold ${highlight ? "text-yellow-800" : "text-gray-900"}`}>{value}</p>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-5 space-y-4">
      <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
        <span className="text-green-700">{icon}</span> {title}
      </h2>
      {children}
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-900">{value}</p>
    </div>
  );
}

function EmptyChart() {
  return <p className="text-center text-gray-400 py-10 text-sm">Nessun dato disponibile</p>;
}
