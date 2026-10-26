// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Plus, Search, List, CalendarDays, Columns3, ChevronLeft, ChevronRight,
  AlertTriangle, Clock, FolderOpen, CheckCircle2, FileDown, FileSpreadsheet, Loader2, Euro,
} from "lucide-react";
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday,
  startOfMonth, startOfWeek,
} from "date-fns";
import { it } from "date-fns/locale";
import clsx from "clsx";
import * as XLSX from "xlsx";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatDate, logAudit, formatCurrency } from "../../lib/utils";
import { generateTablePdf, pdfDate } from "../../lib/pdf";
import { etichettaScadenza, giorniAllaScadenza, oggiISO } from "../../lib/scadenze";
import {
  FUNZIONI, FUNZIONE_LABELS, FUNZIONE_COLORS, PRIORITA_COLORS, PRIORITA_LABELS,
  STATO_PRATICA_COLORS, STATO_PRATICA_LABELS, CATEGORIE_PRATICA, categoriaLabel,
} from "../../constants";
import Modal from "../../components/ui/Modal";
import StatCard from "../../components/ui/StatCard";
import PraticaForm, { praticaFormVuota, PraticaFormValues } from "../../components/agenda/PraticaForm";
import type { Funzione, PraticaAgenda, ScadenzaPagamento } from "../../types";

type Vista = "elenco" | "calendario" | "bacheca";
type FiltroStato = "attive" | "completate" | "tutte";

interface PraticaRow extends PraticaAgenda {
  checklist: { id: string; completata: boolean }[];
}

type ScadenzaCal = Pick<ScadenzaPagamento, "id" | "beneficiario" | "descrizione" | "importo_da_pagare" | "data_scadenza" | "stato" | "tipo">;

const ATTIVE = ["aperta", "in_corso", "sospesa"];

function progresso(p: PraticaRow): { fatte: number; totale: number; perc: number } {
  const totale = p.checklist.length;
  const fatte = p.checklist.filter((c) => c.completata).length;
  return { fatte, totale, perc: totale ? Math.round((fatte / totale) * 100) : p.stato === "completata" ? 100 : 0 };
}

export function BarraProgresso({ perc }: { perc: number }) {
  return (
    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div className={clsx("h-full rounded-full", perc === 100 ? "bg-green-500" : "bg-primary-500")} style={{ width: `${perc}%` }} />
    </div>
  );
}

export default function AgendaPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [pratiche, setPratiche] = useState<PraticaRow[]>([]);
  const [pagamenti, setPagamenti] = useState<ScadenzaCal[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<Vista>("elenco");
  const [responsabile, setResponsabile] = useState<Funzione | "tutti">(user?.funzione ?? "tutti");
  const [filtroStato, setFiltroStato] = useState<FiltroStato>("attive");
  const [categoria, setCategoria] = useState("");
  const [search, setSearch] = useState("");
  const [mese, setMese] = useState(() => startOfMonth(new Date()));
  const [mostraPagamenti, setMostraPagamenti] = useState(true);
  const [showModal, setShowModal] = useState(false);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    const [pRes, sRes] = await Promise.all([
      supabase
        .from("gal_agenda_pratiche")
        .select("*, checklist:gal_agenda_checklist(id, completata)")
        .eq("gal_id", currentGal.id)
        .order("data_scadenza", { ascending: true }),
      supabase
        .from("gal_scadenze_pagamento")
        .select("id, beneficiario, descrizione, importo_da_pagare, data_scadenza, stato, tipo")
        .eq("gal_id", currentGal.id)
        .in("stato", ["da_pagare", "in_pagamento"]),
    ]);
    if (pRes.error) {
      console.error(pRes.error);
      toast.error("Impossibile caricare l'agenda. Verifica che l'aggiornamento del database 4.0 sia stato eseguito.");
    } else {
      setPratiche((pRes.data ?? []) as PraticaRow[]);
    }
    if (sRes.error) console.error(sRes.error);
    else setPagamenti((sRes.data ?? []) as ScadenzaCal[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  const filtrate = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pratiche.filter((p) => {
      if (responsabile !== "tutti" && p.responsabile !== responsabile) return false;
      if (filtroStato === "attive" && !ATTIVE.includes(p.stato)) return false;
      if (filtroStato === "completate" && p.stato !== "completata") return false;
      if (categoria && p.categoria !== categoria) return false;
      if (q && ![p.titolo, p.descrizione ?? "", p.riferimento ?? "", p.codice ?? ""].some((x) => x.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [pratiche, responsabile, filtroStato, categoria, search]);

  // KPI calcolati sul responsabile selezionato (tutte le pratiche attive)
  const kpi = useMemo(() => {
    const base = pratiche.filter((p) => responsabile === "tutti" || p.responsabile === responsabile);
    const attive = base.filter((p) => ATTIVE.includes(p.stato));
    const meseCorrente = oggiISO().slice(0, 7);
    return {
      scadute: attive.filter((p) => giorniAllaScadenza(p.data_scadenza) < 0).length,
      settimana: attive.filter((p) => { const g = giorniAllaScadenza(p.data_scadenza); return g >= 0 && g <= 7; }).length,
      aperte: attive.length,
      completateMese: base.filter((p) => p.stato === "completata" && (p.data_completamento ?? "").startsWith(meseCorrente)).length,
    };
  }, [pratiche, responsabile]);

  async function handleCreate(v: PraticaFormValues) {
    if (!currentGal || !user) return;
    const anno = v.data_apertura.slice(0, 4);
    const numero = pratiche.filter((p) => (p.codice ?? "").endsWith(`/${anno}`)).length + 1;
    const { data, error } = await supabase
      .from("gal_agenda_pratiche")
      .insert({
        gal_id: currentGal.id,
        codice: `PR-${String(numero).padStart(3, "0")}/${anno}`,
        titolo: v.titolo.trim(),
        descrizione: v.descrizione || null,
        categoria: v.categoria,
        responsabile: v.responsabile,
        priorita: v.priorita,
        stato: "aperta",
        data_apertura: v.data_apertura,
        data_scadenza: v.data_scadenza,
        data_promemoria: v.data_promemoria || null,
        ricorrenza: v.ricorrenza,
        riferimento: v.riferimento || null,
        note: v.note || null,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error(error);
      toast.error("Non è stato possibile aprire la pratica. Riprova.");
      return;
    }
    if (v.checklist.length) {
      const { error: clErr } = await supabase.from("gal_agenda_checklist").insert(
        v.checklist.map((descrizione, i) => ({ gal_id: currentGal.id, pratica_id: data.id, descrizione, ordine: i }))
      );
      if (clErr) {
        console.error(clErr);
        toast.warning("Pratica aperta, ma la check list non è stata salvata completamente.");
      }
    }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "pratica_agenda", entitaId: data.id, descrizione: v.titolo });
    toast.success("Pratica aperta correttamente");
    setShowModal(false);
    navigate(`/agenda/${data.id}`);
  }

  function righeExport() {
    return filtrate.map((p) => {
      const pr = progresso(p);
      return {
        codice: p.codice ?? "",
        titolo: p.titolo,
        responsabile: FUNZIONE_LABELS[p.responsabile],
        categoria: categoriaLabel(p.categoria),
        priorita: PRIORITA_LABELS[p.priorita],
        stato: STATO_PRATICA_LABELS[p.stato],
        scadenza: pdfDate(p.data_scadenza),
        avanzamento: pr.totale ? `${pr.fatte}/${pr.totale} (${pr.perc}%)` : "—",
      };
    });
  }

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(righeExport().map((r) => ({
      Codice: r.codice, Pratica: r.titolo, Responsabile: r.responsabile, Categoria: r.categoria,
      Priorità: r.priorita, Stato: r.stato, Scadenza: r.scadenza, Avanzamento: r.avanzamento,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Agenda");
    XLSX.writeFile(wb, `Agenda_scadenze_${oggiISO()}.xlsx`);
    toast.success("Excel esportato");
  }

  function exportPdf() {
    generateTablePdf(
      [
        { header: "Codice", dataKey: "codice" },
        { header: "Pratica", dataKey: "titolo" },
        { header: "Responsabile", dataKey: "responsabile" },
        { header: "Priorità", dataKey: "priorita" },
        { header: "Stato", dataKey: "stato" },
        { header: "Scadenza", dataKey: "scadenza" },
        { header: "Avanzamento", dataKey: "avanzamento" },
      ],
      righeExport(),
      {
        title: "Agenda scadenze",
        subtitle: `Responsabile: ${responsabile === "tutti" ? "Tutti" : FUNZIONE_LABELS[responsabile]} — ${filtrate.length} pratiche`,
        galNome: currentGal?.nome,
        orientation: "landscape",
        filename: `Agenda_scadenze_${oggiISO()}.pdf`,
        showSignatures: false,
      }
    );
    toast.success("PDF generato");
  }

  return (
    <div className="space-y-5">
      {/* Intestazione */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agenda scadenze</h1>
          <p className="text-sm text-gray-500">Pratiche e adempimenti del GAL per Segreteria, Direttore Tecnico e RAF</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={exportExcel} disabled={!filtrate.length}><FileSpreadsheet size={16} /> Excel</button>
          <button className="btn-secondary" onClick={exportPdf} disabled={!filtrate.length}><FileDown size={16} /> PDF</button>
          {write && (
            <button className="btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Nuova pratica</button>
          )}
        </div>
      </div>

      {/* Responsabile */}
      <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1 w-fit flex-wrap">
        {(["tutti", ...FUNZIONI] as const).map((f) => (
          <button key={f} onClick={() => setResponsabile(f)}
            className={clsx("px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              responsabile === f ? "bg-primary-600 text-white" : "text-gray-600 hover:bg-gray-100")}>
            {f === "tutti" ? "Tutti" : FUNZIONE_LABELS[f]}
            {user?.funzione === f && <span className="ml-1 text-xs opacity-75">(io)</span>}
          </button>
        ))}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Scadute" value={kpi.scadute} icon={<AlertTriangle size={20} />} color="red" subtitle="pratiche non chiuse" />
        <StatCard title="Entro 7 giorni" value={kpi.settimana} icon={<Clock size={20} />} color="yellow" />
        <StatCard title="Pratiche aperte" value={kpi.aperte} icon={<FolderOpen size={20} />} color="blue" />
        <StatCard title="Completate nel mese" value={kpi.completateMese} icon={<CheckCircle2 size={20} />} color="green" />
      </div>

      {/* Barra strumenti */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Cerca pratica, riferimento, codice…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={filtroStato} onChange={(e) => setFiltroStato(e.target.value as FiltroStato)}>
          <option value="attive">Da fare</option>
          <option value="completate">Completate</option>
          <option value="tutte">Tutte</option>
        </select>
        <select className="input w-auto" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Tutte le categorie</option>
          {CATEGORIE_PRATICA.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <div className="flex gap-1 border border-gray-200 rounded-lg p-0.5">
          {([["elenco", <List size={16} key="l" />, "Elenco"], ["calendario", <CalendarDays size={16} key="c" />, "Calendario"], ["bacheca", <Columns3 size={16} key="b" />, "Per responsabile"]] as const).map(([k, icon, label]) => (
            <button key={k} title={label} onClick={() => setVista(k)}
              className={clsx("px-2.5 py-1.5 rounded-md text-sm flex items-center gap-1.5", vista === k ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100")}>
              {icon}<span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card p-12 flex items-center justify-center text-gray-400 gap-2"><Loader2 className="animate-spin" size={18} /> Caricamento agenda…</div>
      ) : vista === "elenco" ? (
        <VistaElenco pratiche={filtrate} onOpen={(id) => navigate(`/agenda/${id}`)} />
      ) : vista === "calendario" ? (
        <VistaCalendario
          pratiche={filtrate} pagamenti={mostraPagamenti ? pagamenti : []} mese={mese} setMese={setMese}
          mostraPagamenti={mostraPagamenti} setMostraPagamenti={setMostraPagamenti}
          onOpen={(id) => navigate(`/agenda/${id}`)} onOpenPagamento={(id) => navigate(`/scadenzario/${id}`)}
        />
      ) : (
        <VistaBacheca pratiche={filtrate} onOpen={(id) => navigate(`/agenda/${id}`)} />
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuova pratica" size="xl">
        <PraticaForm
          modalita="crea"
          initial={praticaFormVuota(responsabile === "tutti" ? user?.funzione ?? "segreteria" : responsabile)}
          onSubmit={handleCreate}
          onCancel={() => setShowModal(false)}
        />
      </Modal>
    </div>
  );
}

// ─── Vista elenco ────────────────────────────────────────────────
function VistaElenco({ pratiche, onOpen }: { pratiche: PraticaRow[]; onOpen: (id: string) => void }) {
  if (!pratiche.length) {
    return <div className="card p-12 text-center text-gray-400">Nessuna pratica per i filtri selezionati</div>;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="table-header text-left">Pratica</th>
            <th className="table-header text-left">Responsabile</th>
            <th className="table-header text-left">Priorità</th>
            <th className="table-header text-left">Scadenza</th>
            <th className="table-header text-left w-40">Check list</th>
            <th className="table-header text-left">Stato</th>
          </tr>
        </thead>
        <tbody>
          {pratiche.map((p) => {
            const pr = progresso(p);
            const chiusa = !ATTIVE.includes(p.stato);
            const et = etichettaScadenza(p.data_scadenza);
            return (
              <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => onOpen(p.id)}>
                <td className="table-cell">
                  <div className="font-medium text-gray-900">{p.titolo}</div>
                  <div className="text-xs text-gray-400">{p.codice} · {categoriaLabel(p.categoria)}</div>
                </td>
                <td className="table-cell"><span className={clsx("badge border", FUNZIONE_COLORS[p.responsabile])}>{FUNZIONE_LABELS[p.responsabile]}</span></td>
                <td className="table-cell"><span className={clsx("badge", PRIORITA_COLORS[p.priorita])}>{PRIORITA_LABELS[p.priorita]}</span></td>
                <td className="table-cell whitespace-nowrap">
                  <div>{formatDate(p.data_scadenza)}</div>
                  {!chiusa && <div className={clsx("text-xs", et.classe)}>{et.testo}</div>}
                </td>
                <td className="table-cell">
                  {pr.totale ? (
                    <div className="space-y-1">
                      <BarraProgresso perc={pr.perc} />
                      <div className="text-xs text-gray-500">{pr.fatte}/{pr.totale} passaggi</div>
                    </div>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
                <td className="table-cell"><span className={clsx("badge", STATO_PRATICA_COLORS[p.stato])}>{STATO_PRATICA_LABELS[p.stato]}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Vista calendario ────────────────────────────────────────────
function VistaCalendario({
  pratiche, pagamenti, mese, setMese, mostraPagamenti, setMostraPagamenti, onOpen, onOpenPagamento,
}: {
  pratiche: PraticaRow[];
  pagamenti: ScadenzaCal[];
  mese: Date;
  setMese: (d: Date) => void;
  mostraPagamenti: boolean;
  setMostraPagamenti: (v: boolean) => void;
  onOpen: (id: string) => void;
  onOpenPagamento: (id: string) => void;
}) {
  const giorni = eachDayOfInterval({
    start: startOfWeek(startOfMonth(mese), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(mese), { weekStartsOn: 1 }),
  });

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button className="btn-ghost p-1.5" onClick={() => setMese(addMonths(mese, -1))} title="Mese precedente"><ChevronLeft size={18} /></button>
          <h2 className="text-base font-semibold capitalize w-40 text-center">{format(mese, "LLLL yyyy", { locale: it })}</h2>
          <button className="btn-ghost p-1.5" onClick={() => setMese(addMonths(mese, 1))} title="Mese successivo"><ChevronRight size={18} /></button>
          <button className="btn-secondary py-1 text-xs" onClick={() => setMese(startOfMonth(new Date()))}>Oggi</button>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={mostraPagamenti} onChange={(e) => setMostraPagamenti(e.target.checked)} />
          Mostra scadenze di pagamento
        </label>
      </div>
      <div className="grid grid-cols-7 text-xs font-semibold text-gray-500 uppercase">
        {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((g) => <div key={g} className="px-2 py-1">{g}</div>)}
      </div>
      <div className="grid grid-cols-7 border-l border-t border-gray-200">
        {giorni.map((g) => {
          const iso = format(g, "yyyy-MM-dd");
          const pDay = pratiche.filter((p) => p.data_scadenza === iso);
          const sDay = pagamenti.filter((s) => s.data_scadenza === iso);
          return (
            <div key={iso} className={clsx("min-h-[96px] border-r border-b border-gray-200 p-1 space-y-1",
              !isSameMonth(g, mese) && "bg-gray-50", isToday(g) && "bg-primary-50")}>
              <div className={clsx("text-xs font-medium px-1", isToday(g) ? "text-primary-700" : isSameMonth(g, mese) ? "text-gray-700" : "text-gray-300")}>
                {format(g, "d")}
              </div>
              {pDay.map((p) => (
                <button key={p.id} onClick={() => onOpen(p.id)} title={`${p.titolo} — ${FUNZIONE_LABELS[p.responsabile]}`}
                  className={clsx("w-full text-left text-[11px] leading-tight px-1.5 py-1 rounded border truncate",
                    p.stato === "completata" ? "bg-green-50 text-green-700 border-green-200 line-through" : FUNZIONE_COLORS[p.responsabile])}>
                  {p.titolo}
                </button>
              ))}
              {sDay.map((s) => (
                <button key={s.id} onClick={() => onOpenPagamento(s.id)} title={`${s.beneficiario} — ${formatCurrency(s.importo_da_pagare)}`}
                  className="w-full text-left text-[11px] leading-tight px-1.5 py-1 rounded border truncate bg-rose-50 text-rose-700 border-rose-200 flex items-center gap-1">
                  <Euro size={10} className="flex-shrink-0" />{s.beneficiario}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 flex-wrap text-xs text-gray-500">
        {FUNZIONI.map((f) => <span key={f} className={clsx("badge border", FUNZIONE_COLORS[f])}>{FUNZIONE_LABELS[f]}</span>)}
        <span className="badge border bg-rose-50 text-rose-700 border-rose-200">Pagamenti</span>
      </div>
    </div>
  );
}

// ─── Vista bacheca per responsabile ──────────────────────────────
function VistaBacheca({ pratiche, onOpen }: { pratiche: PraticaRow[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {FUNZIONI.map((f) => {
        const lista = pratiche.filter((p) => p.responsabile === f);
        return (
          <div key={f} className="bg-gray-100 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className={clsx("badge border", FUNZIONE_COLORS[f])}>{FUNZIONE_LABELS[f]}</span>
              <span className="text-xs text-gray-500">{lista.length} pratiche</span>
            </div>
            {lista.length === 0 && <div className="text-xs text-gray-400 text-center py-6">Niente in agenda</div>}
            {lista.map((p) => {
              const pr = progresso(p);
              const et = etichettaScadenza(p.data_scadenza);
              return (
                <button key={p.id} onClick={() => onOpen(p.id)} className="w-full text-left card p-3 hover:shadow-md transition-shadow space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-sm text-gray-900">{p.titolo}</span>
                    <span className={clsx("badge flex-shrink-0", PRIORITA_COLORS[p.priorita])}>{PRIORITA_LABELS[p.priorita]}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{formatDate(p.data_scadenza)}</span>
                    {ATTIVE.includes(p.stato)
                      ? <span className={et.classe}>{et.testo}</span>
                      : <span className={clsx("badge", STATO_PRATICA_COLORS[p.stato])}>{STATO_PRATICA_LABELS[p.stato]}</span>}
                  </div>
                  {pr.totale > 0 && (
                    <div className="space-y-1">
                      <BarraProgresso perc={pr.perc} />
                      <div className="text-[11px] text-gray-500">{pr.fatte}/{pr.totale} passaggi completati</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
