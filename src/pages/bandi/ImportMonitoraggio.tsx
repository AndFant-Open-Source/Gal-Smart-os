// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * ImportMonitoraggio.tsx
 * Importa il file "Monitoraggio domande 19.2.1 GAL" (.xlsx)
 * nella tabella gal_domande_sostegno + gal_pagamenti_bando
 *
 * Struttura Excel: 6 righe di intestazione multi-livello, dati da riga 7
 * Colonne principali (0-indexed):
 *   0 = data aggiornamento    2 = nome GAL          4 = n. bando
 *   5 = tipologia operazione  6 = codice AGEA DS    7 = CUAA
 *   8 = denominazione         9 = comune            10 = provincia
 *  11 = RUP                  12 = stato istruttorio 13 = ammissibile/no
 *  14 = n. verbale CdA       15 = data verbale      16 = posizione grad.
 *  17 = finanziabile         20 = inv. richiesto    21 = SP richiesta
 *  22 = inv. ammissibile     23 = SP ammissibile    24 = n. atto conc.
 *  25 = data atto conc.      26 = data accettazione 27 = CUP
 *  35 = rinuncia SI/NO       36 = data rinuncia
 * Pagamenti:
 *  73-77 = ANTICIPO   78-83 = ACCONTO 1   84-89 = ACCONTO 2   90-95 = SALDO
 */

import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { logAudit } from "../../lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft, Upload, CheckCircle2, AlertCircle, FileSpreadsheet,
  Info, ChevronRight, Loader2,
} from "lucide-react";

interface RowPreview {
  codice_agea: string;
  cuaa: string;
  denominazione: string;
  comune: string;
  tipologia_op: string;
  ammissibile: string;
  sp_ammissibile: number | null;
  stato_derivato: string;
  warnings: string[];
}

interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

function parseDate(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (typeof v === "string" && v.trim()) {
    const parts = v.trim().split(/[/\-.]/);
    if (parts.length === 3) {
      // dd/mm/yyyy
      if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
      // yyyy-mm-dd
      if (parts[0].length === 4) return v.trim().slice(0, 10);
    }
  }
  return null;
}

function parseNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".").replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function deriveStato(row: unknown[]): string {
  const rinuncia = str(row[35]).toUpperCase();
  if (rinuncia === "SI" || rinuncia === "SÌ") return "rinunciata";
  const amm = str(row[13]).toLowerCase();
  if (amm.includes("non")) return "non_ammessa";
  const fin = str(row[17]).toUpperCase();
  if (fin === "SI" || fin === "SÌ") return "finanziata";
  const ammOk = amm.includes("amm") && !amm.includes("non");
  if (ammOk) return "ammessa";
  return "presentata";
}

export default function ImportMonitoraggio() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);

  const selectedGalId = currentGal?.id ?? "";
  const [file, setFile] = useState<File | null>(null);
  const [previews, setPreviews] = useState<RowPreview[]>([]);
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [filterGal, setFilterGal] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);


  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    processExcel(f);
  }

  function processExcel(f: File) {
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const all: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        // I dati iniziano dalla riga 7 (index 6)
        const dataRows = all.slice(6).filter((row) => row && str(row[6]));

        setRawRows(dataRows as unknown[][]);

        const prev: RowPreview[] = dataRows.map((row) => {
          const r = row as unknown[];
          const warnings: string[] = [];
          if (!str(r[6])) warnings.push("Codice AGEA DS mancante");
          if (!str(r[8])) warnings.push("Denominazione mancante");
          const sp = parseNum(r[23]);
          if (sp === null) warnings.push("SP ammissibile non valorizzata");

          return {
            codice_agea: str(r[6]),
            cuaa: str(r[7]),
            denominazione: str(r[8]),
            comune: str(r[9]),
            tipologia_op: str(r[5]),
            ammissibile: str(r[13]),
            sp_ammissibile: sp,
            stato_derivato: deriveStato(r),
            warnings,
          };
        });

        setPreviews(prev);
        setStep("preview");
      } catch (err) {
        toast.error("Errore lettura file: " + String(err));
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(f);
  }

  async function handleImport() {
    if (!selectedGalId || !user) {
      toast.error("Dati del GAL non ancora caricati: ricarica la pagina e riprova");
      return;
    }
    setLoading(true);

    // Prima carica i bandi esistenti del GAL (per fare match per numero)
    const { data: bandiDb } = await supabase
      .from("gal_bandi").select("id,numero").eq("gal_id", selectedGalId);
    const bandiMap: Record<string, string> = {};
    (bandiDb ?? []).forEach((b: { id: string; numero: string }) => { bandiMap[String(b.numero)] = b.id; });

    let inserted = 0, updated = 0, skipped = 0;
    const errors: string[] = [];

    for (const row of rawRows) {
      const r = row as unknown[];
      const codiceAgea = str(r[6]);
      if (!codiceAgea) { skipped++; continue; }
      const denominazione = str(r[8]) || codiceAgea;

      try {
        const numeroBando = str(r[4]);
        const bandoId = bandiMap[numeroBando] ?? null;

        const domandaPayload = {
          gal_id: selectedGalId,
          bando_id: bandoId,
          codice_agea_ds: codiceAgea,
          denominazione,
          cuaa: str(r[7]) || null,
          comune: str(r[9]) || null,
          provincia: str(r[10]) || null,
          stato: deriveStato(r),
          spesa_pubblica_ammissibile: parseNum(r[23]) ?? 0,
          contributo_concesso: parseNum(r[23]) ?? 0,
          posizione_graduatoria: parseNum(r[16]) ? Math.round(parseNum(r[16])!) : null,
          data_presentazione: parseDate(r[25]) ?? null,
          data_concessione: parseDate(r[25]) ?? null,
          note: [
            str(r[12]) ? `Stato istruttorio: ${str(r[12])}` : "",
            str(r[27]) ? `CUP: ${str(r[27])}` : "",
            str(r[5]) ? `Tipologia: ${str(r[5])}` : "",
            str(r[11]) ? `RUP: ${str(r[11])}` : "",
          ].filter(Boolean).join(" | ") || null,
        };

        // Upsert su codice_agea_ds
        const { data: existing } = await supabase
          .from("gal_domande_sostegno")
          .select("id")
          .eq("codice_agea_ds", codiceAgea)
          .eq("gal_id", selectedGalId)
          .maybeSingle();

        let domandaId: string;
        if (existing) {
          await supabase.from("gal_domande_sostegno").update(domandaPayload).eq("id", existing.id);
          domandaId = existing.id;
          updated++;
        } else {
          const { data: ins, error: insErr } = await supabase
            .from("gal_domande_sostegno").insert(domandaPayload).select("id").single();
          if (insErr || !ins) { errors.push(`${codiceAgea}: ${insErr?.message}`); skipped++; continue; }
          domandaId = ins.id;
          inserted++;
        }

        // ── Pagamenti ──────────────────────────────────────────────
        type PagBlock = { tipo: string; col_agea: number; col_data: number; col_richiesto: number; col_liquidato: number };
        const pagBlocks: PagBlock[] = [
          { tipo: "anticipo",  col_agea: 73, col_data: 74, col_richiesto: 75, col_liquidato: 77 },
          { tipo: "acconto",   col_agea: 78, col_data: 79, col_richiesto: 80, col_liquidato: 83 },
          { tipo: "sal",       col_agea: 84, col_data: 85, col_richiesto: 86, col_liquidato: 89 },
          { tipo: "saldo",     col_agea: 90, col_data: 91, col_richiesto: 92, col_liquidato: 95 },
        ];

        for (const pb of pagBlocks) {
          const importoLiq = parseNum(r[pb.col_liquidato]);
          const importoRich = parseNum(r[pb.col_richiesto]);
          const importo = importoLiq ?? importoRich;
          if (!importo) continue;

          const pagPayload = {
            gal_id: selectedGalId,
            domanda_id: domandaId,
            tipo: pb.tipo,
            importo,
            data_pagamento: parseDate(r[pb.col_data]) ?? null,
            note: str(r[pb.col_agea]) ? `Codice AGEA: ${str(r[pb.col_agea])}` : null,
          };

          const { data: exPag } = await supabase
            .from("gal_pagamenti_bando")
            .select("id")
            .eq("domanda_id", domandaId)
            .eq("tipo", pb.tipo)
            .maybeSingle();

          if (exPag) {
            await supabase.from("gal_pagamenti_bando").update(pagPayload).eq("id", exPag.id);
          } else {
            await supabase.from("gal_pagamenti_bando").insert(pagPayload);
          }
        }
      } catch (err) {
        errors.push(`${codiceAgea}: ${String(err)}`);
        skipped++;
      }
    }

    await logAudit({
      galId: selectedGalId,
      userId: user.id,
      username: user.nome_completo,
      azione: "IMPORT",
      entita: "monitoraggio",
      descrizione: `Importato ${file?.name} — ${inserted} inseriti, ${updated} aggiornati`,
    });

    setResult({ inserted, updated, skipped, errors });
    setStep("done");
    setLoading(false);
    toast.success(`Importazione completata: ${inserted} nuovi, ${updated} aggiornati`);
  }

  const filteredPreviews = filterGal
    ? previews.filter((p) => p.denominazione.toLowerCase().includes(filterGal.toLowerCase()) || p.codice_agea.includes(filterGal))
    : previews;

  const warnCount = previews.filter((p) => p.warnings.length > 0).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button className="btn-ghost p-1" onClick={() => navigate("/bandi")}><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-xl font-bold">Import Monitoraggio GAL</h1>
          <p className="text-sm text-gray-500">Importa il file Excel "Monitoraggio domande 19.2.1" nelle domande di sostegno</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(["upload", "preview", "done"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === s ? "bg-green-700 text-white" : previews.length > 0 && i < ["upload","preview","done"].indexOf(step) ? "bg-green-200 text-green-800" : "bg-gray-200 text-gray-500"}`}>
              {i + 1}
            </div>
            <span className={step === s ? "font-semibold text-green-700" : "text-gray-400"}>
              {s === "upload" ? "Carica file" : s === "preview" ? "Anteprima" : "Risultato"}
            </span>
            {i < 2 && <ChevronRight size={14} className="text-gray-300" />}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === "upload" && (
        <div className="card p-8 text-center space-y-4">
          <FileSpreadsheet size={48} className="mx-auto text-green-700" />
          <div>
            <p className="font-semibold text-lg">Seleziona il file Monitoraggio</p>
            <p className="text-sm text-gray-500 mt-1">Formato: .xlsx — Il file deve avere 6 righe di intestazione e dati dalla riga 7</p>
          </div>
          <button className="btn-primary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Scegli file .xlsx
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />

          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-left text-xs text-blue-800 space-y-1">
            <div className="flex items-start gap-2"><Info size={12} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Colonne rilevanti lette automaticamente:</p>
                <p>Codice AGEA DS, CUAA, Denominazione, Comune, Provincia, Tipologia operazione, Spesa pubblica, Atto di concessione, CUP, Stato istruttorio, Finanziabile, Pagamenti (Anticipo/Acconto/SAL/Saldo)</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Preview ── */}
      {step === "preview" && (
        <div className="space-y-4">
          {/* GAL selector */}
          <div className="card p-4 flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="label">GAL di destinazione *</label>
              <input className="input bg-gray-50" readOnly value={currentGal?.nome ?? ""} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="label">Filtra anteprima</label>
              <input className="input" placeholder="Cerca denominazione o codice AGEA..." value={filterGal} onChange={(e) => setFilterGal(e.target.value)} />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4">
              <p className="text-xs text-gray-500">Righe trovate</p>
              <p className="text-2xl font-bold">{previews.length}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500">Da importare</p>
              <p className="text-2xl font-bold text-green-700">{previews.length - previews.filter(p => p.warnings.length > 2).length}</p>
            </div>
            <div className={`card p-4 ${warnCount > 0 ? "border-l-4 border-yellow-400" : ""}`}>
              <p className="text-xs text-gray-500">Con avvisi</p>
              <p className={`text-2xl font-bold ${warnCount > 0 ? "text-yellow-600" : "text-gray-400"}`}>{warnCount}</p>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="bg-slate-700 text-white sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left">Codice AGEA</th>
                    <th className="px-3 py-2 text-left">Denominazione</th>
                    <th className="px-3 py-2 text-left">Comune</th>
                    <th className="px-3 py-2 text-left">Tipologia op.</th>
                    <th className="px-3 py-2 text-left">Ammissibile</th>
                    <th className="px-3 py-2 text-right">SP amm.</th>
                    <th className="px-3 py-2 text-center">Stato</th>
                    <th className="px-3 py-2 text-center">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPreviews.slice(0, 200).map((p, i) => (
                    <tr key={i} className={`border-b border-gray-100 ${p.warnings.length > 0 ? "bg-yellow-50" : "hover:bg-gray-50"}`}>
                      <td className="px-3 py-1.5 font-mono">{p.codice_agea}</td>
                      <td className="px-3 py-1.5 max-w-[180px] truncate">{p.denominazione}</td>
                      <td className="px-3 py-1.5">{p.comune}</td>
                      <td className="px-3 py-1.5">{p.tipologia_op}</td>
                      <td className="px-3 py-1.5">{p.ammissibile}</td>
                      <td className="px-3 py-1.5 text-right">{p.sp_ammissibile != null ? p.sp_ammissibile.toLocaleString("it-IT") : "—"}</td>
                      <td className="px-3 py-1.5 text-center">
                        <span className={`badge text-xs ${p.stato_derivato === "rinunciata" ? "bg-red-100 text-red-600" : p.stato_derivato === "finanziata" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                          {p.stato_derivato}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {p.warnings.length > 0 && (
                          <span title={p.warnings.join("; ")} className="text-yellow-500 cursor-help">
                            <AlertCircle size={12} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredPreviews.length > 200 && <p className="text-xs text-center text-gray-400 py-2">Mostrando 200 di {filteredPreviews.length} righe</p>}
            </div>
          </div>

          <div className="flex gap-3">
            <button className="btn-secondary" onClick={() => { setStep("upload"); setPreviews([]); setFile(null); }}>
              ← Cambia file
            </button>
            <button
              className="btn-primary flex-1"
              onClick={handleImport}
              disabled={loading || !selectedGalId}
            >
              {loading ? <><Loader2 size={16} className="animate-spin" /> Importazione in corso...</> : `Importa ${previews.length} domande`}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Done ── */}
      {step === "done" && result && (
        <div className="space-y-4">
          <div className="card p-6 text-center space-y-3">
            <CheckCircle2 size={48} className="mx-auto text-green-600" />
            <h2 className="text-xl font-bold text-green-700">Importazione completata</h2>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 border-l-4 border-green-600">
              <p className="text-xs text-gray-500">Nuovi record</p>
              <p className="text-2xl font-bold text-green-700">{result.inserted}</p>
            </div>
            <div className="card p-4 border-l-4 border-blue-500">
              <p className="text-xs text-gray-500">Aggiornati</p>
              <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
            </div>
            <div className="card p-4 border-l-4 border-gray-400">
              <p className="text-xs text-gray-500">Saltati/Errori</p>
              <p className="text-2xl font-bold text-gray-500">{result.skipped}</p>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="card p-4 bg-red-50 border border-red-200">
              <p className="text-sm font-semibold text-red-700 mb-2">Errori ({result.errors.length}):</p>
              <ul className="text-xs text-red-600 space-y-1 max-h-32 overflow-y-auto">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          <div className="flex gap-3">
            <button className="btn-primary flex-1" onClick={() => navigate("/domande")}>
              Vai alle domande
            </button>
            <button className="btn-secondary" onClick={() => { setStep("upload"); setFile(null); setPreviews([]); setResult(null); }}>
              Nuova importazione
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
