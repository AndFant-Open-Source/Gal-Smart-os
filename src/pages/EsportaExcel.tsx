// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useMemo, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";
import { FileSpreadsheet, Loader2, CheckSquare, Square, Download, Info } from "lucide-react";
import { useAuthStore, isAdmin } from "../stores/auth";
import { useGalStore } from "../stores/gal";
import { logAudit } from "../lib/utils";
import { SEZIONI_EXPORT, esportaDatabaseExcel } from "../lib/esportazioneDati";

export default function EsportaExcel() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const admin = isAdmin(user);

  const [selezionate, setSelezionate] = useState<Set<string>>(
    () => new Set(SEZIONI_EXPORT.filter((s) => admin || s.gruppo !== "Amministrazione").map((s) => s.tabella))
  );
  const [busy, setBusy] = useState(false);
  const [progresso, setProgresso] = useState({ perc: 0, testo: "" });

  const sezioniVisibili = SEZIONI_EXPORT.filter((s) => admin || s.gruppo !== "Amministrazione");
  const gruppi = useMemo(() => {
    const m = new Map<string, typeof SEZIONI_EXPORT>();
    for (const s of sezioniVisibili) m.set(s.gruppo, [...(m.get(s.gruppo) ?? []), s]);
    return [...m.entries()];
  }, [admin]);

  function toggle(tabella: string) {
    setSelezionate((prev) => {
      const n = new Set(prev);
      if (n.has(tabella)) n.delete(tabella); else n.add(tabella);
      return n;
    });
  }

  function toggleGruppo(sezioni: typeof SEZIONI_EXPORT) {
    const tutte = sezioni.every((s) => selezionate.has(s.tabella));
    setSelezionate((prev) => {
      const n = new Set(prev);
      sezioni.forEach((s) => (tutte ? n.delete(s.tabella) : n.add(s.tabella)));
      return n;
    });
  }

  async function esporta() {
    if (!selezionate.size) { toast.error("Seleziona almeno una sezione"); return; }
    if (!currentGal) { toast.error("Dati del GAL non ancora caricati, riprova tra un istante"); return; }
    setBusy(true);
    try {
      const nome = currentGal.nome;
      const { blob, record, fogli } = await esportaDatabaseExcel({
        tabelle: [...selezionate],
        galId: currentGal.id,
        galNome: nome,
        onProgress: (perc, testo) => setProgresso({ perc, testo }),
      });
      const oggi = new Date().toISOString().slice(0, 10);
      const file = `GAL_Smart_${nome.replace(/[^A-Za-z0-9]+/g, "_")}_${oggi}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url); // rilascio ritardato: vedi lib/downloadSicuri.ts
      if (user) {
        await logAudit({ galId: currentGal?.id ?? null, userId: user.id, username: user.nome_completo, azione: "EXPORT", entita: "excel", descrizione: `${fogli} sezioni, ${record} record` });
      }
      toast.success(`File Excel creato: ${fogli} sezioni, ${record} record`);
    } catch (e) {
      console.error(e);
      toast.error("Non è stato possibile creare il file Excel. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Esporta dati in Excel</h1>
        <p className="text-sm text-gray-500">
          Crea un unico file Excel con un foglio per ogni sezione. Ogni foglio contiene una tabella Excel
          con intestazioni, filtri, date e importi già formattati.
        </p>
      </div>

      <div className="card p-4 flex items-center gap-4 flex-wrap">
        <span className="text-sm text-gray-700">Dati di <strong>{currentGal?.nome ?? "questo GAL"}</strong></span>
        <div className="flex-1" />
        <button className="btn-secondary py-1 text-xs" onClick={() => setSelezionate(new Set(sezioniVisibili.map((s) => s.tabella)))}>Seleziona tutto</button>
        <button className="btn-secondary py-1 text-xs" onClick={() => setSelezionate(new Set())}>Deseleziona tutto</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {gruppi.map(([gruppo, sezioni]) => {
          const tutte = sezioni.every((s) => selezionate.has(s.tabella));
          return (
            <div key={gruppo} className="card p-4">
              <button className="flex items-center gap-2 font-semibold text-gray-900 mb-2" onClick={() => toggleGruppo(sezioni)}>
                {tutte ? <CheckSquare size={18} className="text-primary-600" /> : <Square size={18} className="text-gray-400" />}
                {gruppo}
              </button>
              <div className="space-y-1 pl-1">
                {sezioni.map((s) => (
                  <label key={s.tabella} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={selezionate.has(s.tabella)} onChange={() => toggle(s.tabella)} />
                    {s.foglio}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-start gap-2 text-xs text-gray-500">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          Il primo foglio "Indice" elenca tutte le sezioni con il numero di record e i collegamenti ai fogli.
          I riferimenti interni (pratica, conto, fornitore, bando…) sono scritti per esteso. Gli allegati non sono inclusi:
          per una copia completa usa Backup &amp; Ripristino.
        </div>
        {busy && (
          <div className="space-y-1">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 transition-all" style={{ width: `${progresso.perc}%` }} />
            </div>
            <div className="text-xs text-gray-500">{progresso.testo}</div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-gray-600">{selezionate.size} sezioni selezionate</span>
          <button className={clsx("btn-primary")} onClick={esporta} disabled={busy || !selezionate.size}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}
            Crea file Excel
            {!busy && <Download size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
