// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency } from "../../lib/utils";
import StatCard from "../../components/ui/StatCard";
import {
  ScrollText, Users, FileSpreadsheet, ShoppingCart,
  TrendingUp, AlertCircle, CheckCircle2, Clock, Building2,
  Landmark, CalendarDays, Euro
} from "lucide-react";

interface BandiStats {
  totale_bandi: number;
  totale_domande: number;
  domande_finanziate: number;
  domande_liquidate: number;
  totale_spesa_pubblica: number;
}

interface RendStats {
  totale_giustificativi: number;
  totale_importo: number;
  totale_pagato: number;
  totale_da_pagare: number;
  num_fornitori: number;
}

interface MisuraRow {
  misura: string;
  sotto_misura: string;
  totale_imputato: number;
  totale_richiesto: number;
  imponibile_imputato: number;
  iva_imputato: number;
  imponibile_richiesto: number;
  iva_richiesta: number;
}

interface MisuraAgg {
  key: string;
  misura: string;
  sotto_misura: string;
  sostenuto: number;
  rendicontato: number;
  richiesto: number;
}

interface OrganiStats {
  totale_soci: number;
  soci_attivi: number;
  totale_sedute: number;
  ultima_seduta: string | null;
}

interface AcqStats {
  totale_procedure: number;
  importo_stimato: number;
  importo_aggiudicato: number;
  da_pubblicare_anac: number;
}

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const [bandiStats, setBandiStats] = useState<BandiStats | null>(null);
  const [rendStats, setRendStats] = useState<RendStats | null>(null);
  const [misureAgg, setMisureAgg] = useState<MisuraAgg[]>([]);
  const [organiStats, setOrganiStats] = useState<OrganiStats | null>(null);
  const [acqStats, setAcqStats] = useState<AcqStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentGal) return;
    setLoading(true);
    const gid = currentGal.id;

    async function load() {
      // ── Bandi ──
      const { data: bandi } = await supabase.from("gal_bandi").select("id").eq("gal_id", gid);
      const { data: domande } = await supabase
        .from("gal_domande_sostegno")
        .select("stato, spesa_pubblica_ammissibile")
        .eq("gal_id", gid);

      const dom = domande ?? [];
      setBandiStats({
        totale_bandi: (bandi ?? []).length,
        totale_domande: dom.length,
        domande_finanziate: dom.filter((d: { stato: string }) => ["finanziata", "liquidata"].includes(d.stato)).length,
        domande_liquidate: dom.filter((d: { stato: string }) => d.stato === "liquidata").length,
        totale_spesa_pubblica: dom.reduce((s: number, d: { spesa_pubblica_ammissibile: number }) => s + (d.spesa_pubblica_ammissibile ?? 0), 0),
      });

      // ── Rendicontazione ──
      // 1) Giustificativi: totale e id
      const { data: giust } = await supabase
        .from("gal_giustificativi")
        .select("id, totale, stato")
        .eq("gal_id", gid)
        .neq("stato", "annullata");

      const g = giust ?? [];
      const giustIds = g.map((x: { id: string }) => x.id);
      const totImporto = g.reduce((s: number, x: { totale: number }) => s + (x.totale ?? 0), 0);

      // 2) Pagamenti: somma importi da gal_pagamenti_giust
      let totPagato = 0;
      if (giustIds.length > 0) {
        const { data: pagamenti } = await supabase
          .from("gal_pagamenti_giust")
          .select("importo")
          .in("giustificativo_id", giustIds);
        totPagato = (pagamenti ?? []).reduce((s: number, x: { importo: number }) => s + (x.importo ?? 0), 0);
      }

      // 3) Fornitori
      const { count: numForn } = await supabase
        .from("gal_fornitori").select("id", { count: "exact", head: true }).eq("gal_id", gid);

      setRendStats({
        totale_giustificativi: g.length,
        totale_importo: totImporto,
        totale_pagato: totPagato,
        totale_da_pagare: totImporto - totPagato,
        num_fornitori: numForn ?? 0,
      });

      // 4) Righe imputazione per misura
      if (giustIds.length > 0) {
        try {
          const { data: righe } = await supabase
            .from("gal_righe_imputazione")
            .select("misura, sotto_misura, imponibile_imputato, iva_imputato, totale_imputato, imponibile_richiesto, iva_richiesta, totale_richiesto")
            .in("giustificativo_id", giustIds);

          const r = (righe ?? []) as MisuraRow[];
          const map = new Map<string, MisuraAgg>();
          for (const row of r) {
            const key = `${row.misura ?? ""}|${row.sotto_misura ?? ""}`;
            const existing = map.get(key);
            if (existing) {
              existing.sostenuto += (row.totale_imputato ?? 0);
              existing.rendicontato += ((row.imponibile_imputato ?? 0) + (row.iva_imputato ?? 0));
              existing.richiesto += (row.totale_richiesto ?? 0);
            } else {
              map.set(key, {
                key,
                misura: row.misura ?? "-",
                sotto_misura: row.sotto_misura ?? "",
                sostenuto: row.totale_imputato ?? 0,
                rendicontato: (row.imponibile_imputato ?? 0) + (row.iva_imputato ?? 0),
                richiesto: row.totale_richiesto ?? 0,
              });
            }
          }
          setMisureAgg(Array.from(map.values()).sort((a, b) => a.misura.localeCompare(b.misura)));
        } catch {
          setMisureAgg([]);
        }
      } else {
        setMisureAgg([]);
      }

      // ── Organi Sociali ──
      try {
        const { data: soci } = await supabase
          .from("gal_soci")
          .select("id, attivo")
          .eq("gal_id", gid);
        const s = soci ?? [];

        const { data: sedute } = await supabase
          .from("gal_sedute")
          .select("id, data_seduta")
          .eq("gal_id", gid)
          .order("data_seduta", { ascending: false });
        const sed = sedute ?? [];

        setOrganiStats({
          totale_soci: s.length,
          soci_attivi: s.filter((x: { attivo: boolean }) => x.attivo !== false).length,
          totale_sedute: sed.length,
          ultima_seduta: sed.length > 0 ? (sed[0] as { data_seduta: string }).data_seduta : null,
        });
      } catch {
        setOrganiStats({ totale_soci: 0, soci_attivi: 0, totale_sedute: 0, ultima_seduta: null });
      }

      // ── Acquisti ──
      const { data: proc } = await supabase
        .from("gal_procedure")
        .select("importo_stimato, importo_aggiudicato, pubblicato_anac")
        .eq("gal_id", gid);
      const p = proc ?? [];
      setAcqStats({
        totale_procedure: p.length,
        importo_stimato: p.reduce((s: number, x: { importo_stimato: number }) => s + (x.importo_stimato ?? 0), 0),
        importo_aggiudicato: p.reduce((s: number, x: { importo_aggiudicato: number | null }) => s + (x.importo_aggiudicato ?? 0), 0),
        da_pubblicare_anac: p.filter((x: { pubblicato_anac: boolean }) => !x.pubblicato_anac).length,
      });

      setLoading(false);
    }

    load().catch(console.error);
  }, [currentGal?.id]);

  const getHour = () => {
    const h = new Date().getHours();
    if (h < 12) return "Buongiorno";
    if (h < 18) return "Buon pomeriggio";
    return "Buonasera";
  };

  if (!currentGal) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Building2 size={48} className="text-gray-300" />
        <p className="text-gray-500">Nessun GAL disponibile. Contatta l'amministratore.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {getHour()}, {user?.nome_completo?.split(" ")[0]}
          </h1>
          <p className="text-gray-500 mt-1">
            {new Date().toLocaleDateString("it-IT", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">GAL corrente</p>
          <p className="text-sm font-semibold text-gray-700">{currentGal.nome}</p>
          {currentGal.codice && <p className="text-xs text-gray-400">{currentGal.codice}</p>}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-4 bg-gray-200 rounded mb-2 w-2/3" />
              <div className="h-8 bg-gray-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* ══════ Bandi ══════ */}
          <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-2">
                <ScrollText size={16} className="text-blue-500" /> Bandi
              </h2>
              <Link to="/bandi" className="text-sm text-primary-600 hover:underline">Vedi tutti &rarr;</Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard title="Bandi" value={bandiStats?.totale_bandi ?? 0} icon={<ScrollText size={20} />} color="blue" />
              <StatCard title="Domande totali" value={bandiStats?.totale_domande ?? 0} icon={<FileSpreadsheet size={20} />} color="purple" />
              <StatCard
                title="Finanziate"
                value={bandiStats?.domande_finanziate ?? 0}
                subtitle={`di cui ${bandiStats?.domande_liquidate ?? 0} liquidate`}
                icon={<CheckCircle2 size={20} />}
                color="green"
              />
              <StatCard
                title="Spesa pubblica ammissibile"
                value={formatCurrency(bandiStats?.totale_spesa_pubblica ?? 0)}
                icon={<TrendingUp size={20} />}
                color="yellow"
              />
            </div>
          </section>

          {/* ══════ Rendicontazione ══════ */}
          <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-2">
                <FileSpreadsheet size={16} className="text-green-500" /> Rendicontazione
              </h2>
              <Link to="/giustificativi" className="text-sm text-primary-600 hover:underline">Vedi tutti &rarr;</Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard title="Giustificativi" value={rendStats?.totale_giustificativi ?? 0} icon={<FileSpreadsheet size={20} />} color="blue" />
              <StatCard title="Totale sostenuto" value={formatCurrency(rendStats?.totale_importo ?? 0)} icon={<TrendingUp size={20} />} color="green" />
              <StatCard title="Totale pagato" value={formatCurrency(rendStats?.totale_pagato ?? 0)} icon={<Euro size={20} />} color="purple" />
              <StatCard title="Da pagare" value={formatCurrency(rendStats?.totale_da_pagare ?? 0)} icon={<Clock size={20} />} color={((rendStats?.totale_da_pagare ?? 0) > 0) ? "yellow" : "green"} />
              <StatCard title="Fornitori" value={rendStats?.num_fornitori ?? 0} icon={<Users size={20} />} color="blue" />
            </div>

            {/* Breakdown per Misura */}
            {misureAgg.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Dettaglio per Misura
                </h3>
                <div className="overflow-x-auto rounded-lg border border-gray-100">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-4 py-2.5 font-semibold text-gray-600">Misura</th>
                        <th className="px-4 py-2.5 font-semibold text-gray-600">Sotto-misura</th>
                        <th className="px-4 py-2.5 font-semibold text-gray-600 text-right">Sostenuto</th>
                        <th className="px-4 py-2.5 font-semibold text-gray-600 text-right">Rendicontato</th>
                        <th className="px-4 py-2.5 font-semibold text-gray-600 text-right">Richiesto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {misureAgg.map((m) => (
                        <tr key={m.key} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-gray-800">{m.misura}</td>
                          <td className="px-4 py-2.5 text-gray-600">{m.sotto_misura || "-"}</td>
                          <td className="px-4 py-2.5 text-right text-gray-800 font-mono">{formatCurrency(m.sostenuto)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-800 font-mono">{formatCurrency(m.rendicontato)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-800 font-mono">{formatCurrency(m.richiesto)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {misureAgg.length > 1 && (
                      <tfoot>
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-4 py-2.5 text-gray-700" colSpan={2}>Totale</td>
                          <td className="px-4 py-2.5 text-right text-gray-900 font-mono">
                            {formatCurrency(misureAgg.reduce((s, m) => s + m.sostenuto, 0))}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-900 font-mono">
                            {formatCurrency(misureAgg.reduce((s, m) => s + m.rendicontato, 0))}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-900 font-mono">
                            {formatCurrency(misureAgg.reduce((s, m) => s + m.richiesto, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ══════ Organi Sociali ══════ */}
          <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-2">
                <Landmark size={16} className="text-purple-500" /> Organi Sociali
              </h2>
              <Link to="/soci" className="text-sm text-primary-600 hover:underline">Vedi tutti &rarr;</Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard
                title="Soci"
                value={organiStats?.totale_soci ?? 0}
                subtitle={`${organiStats?.soci_attivi ?? 0} attivi`}
                icon={<Users size={20} />}
                color="purple"
              />
              <StatCard
                title="Sedute"
                value={organiStats?.totale_sedute ?? 0}
                icon={<CalendarDays size={20} />}
                color="blue"
              />
              <StatCard
                title="Ultima seduta"
                value={
                  organiStats?.ultima_seduta
                    ? new Date(organiStats.ultima_seduta).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
                    : "N/D"
                }
                icon={<Clock size={20} />}
                color={organiStats?.ultima_seduta ? "green" : "yellow"}
              />
            </div>
          </section>

          {/* ══════ Acquisti ══════ */}
          <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-2">
                <ShoppingCart size={16} className="text-yellow-500" /> Procedure d'Acquisto
              </h2>
              <Link to="/procedure" className="text-sm text-primary-600 hover:underline">Vedi tutti &rarr;</Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard title="Procedure totali" value={acqStats?.totale_procedure ?? 0} icon={<ShoppingCart size={20} />} color="blue" />
              <StatCard title="Importo stimato" value={formatCurrency(acqStats?.importo_stimato ?? 0)} icon={<TrendingUp size={20} />} color="green" />
              <StatCard title="Importo aggiudicato" value={formatCurrency(acqStats?.importo_aggiudicato ?? 0)} icon={<CheckCircle2 size={20} />} color="purple" />
              <StatCard
                title="Da pubblicare ANAC"
                value={acqStats?.da_pubblicare_anac ?? 0}
                icon={<AlertCircle size={20} />}
                color={(acqStats?.da_pubblicare_anac ?? 0) > 0 ? "red" : "green"}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
