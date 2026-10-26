// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../stores/auth";
import { useGalStore } from "../stores/gal";
import { logAudit, messaggioErrore } from "../lib/utils";
import { toast } from "sonner";
import { Download, Upload, AlertTriangle, CheckCircle, Loader2, HardDrive, Database, FileArchive } from "lucide-react";
import JSZip from "jszip";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import type { Gal } from "../types";

/**
 * Lista completa delle tabelle GAL da includere nel backup.
 * Il database contiene un solo GAL: ogni tabella viene esportata per intero.
 */
const GAL_TABLES = [
  "gal_gal",
  "gal_profili",
  "gal_bandi",
  "gal_domande_sostegno",
  "gal_pagamenti_bando",
  "gal_soci",
  "gal_quote_sociali",
  "gal_organi",
  "gal_componenti",
  "gal_sedute",
  "gal_delibere",
  "gal_fornitori",
  "gal_periodi_ses",
  "gal_interventi",
  "gal_tipologie_spesa",
  "gal_capitoli",
  "gal_voci_previsione",
  "gal_giustificativi",
  "gal_pagamenti_giust",
  "gal_righe_imputazione",
  "gal_documenti_giustificativo",
  "gal_procedure",
  "gal_procedure_invitati",
  "gal_contratti",
  "gal_fascicoli",
  "gal_agenda_pratiche",
  "gal_agenda_checklist",
  "gal_agenda_note",
  "gal_conti",
  "gal_scadenze_pagamento",
  "gal_movimenti_cassa",
  "gal_audit",
];

/** Cartelle storage da includere */
const STORAGE_BUCKET = "documenti_gal";

/** Campi che contengono path di file nello storage, per ogni tabella */
const STORAGE_PATH_FIELDS: Record<string, string[]> = {
  gal_documenti_giustificativo: ["storage_path"],
  gal_contratti: ["documento_path"],
  gal_sedute: ["verbale_path"],
  gal_scadenze_pagamento: ["fattura_path", "bonifico_path"],
};

/** Converte un array di oggetti in stringa CSV */
function arrayToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = typeof val === "object" ? JSON.stringify(val) : String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return lines.join("\n");
}

/** Parse CSV back to array of objects */
function csvToArray(csv: string): Record<string, string>[] {
  if (!csv.trim()) return [];
  // Un'unica passata: virgole, virgolette ("") e a capo dentro i campi tra virgolette
  // restano nel valore invece di spezzare la riga o la colonna.
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter((r) => r.length > 1 || r[0] !== "");
  if (nonEmpty.length < 2) return [];
  const [headers, ...dataRows] = nonEmpty;
  return dataRows.map((values) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] ?? ""; });
    return obj;
  });
}


interface BackupLog {
  time: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
}

export default function BackupRestore() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const setCurrentGal = useGalStore((s) => s.setCurrentGal);

  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [logs, setLogs] = useState<BackupLog[]>([]);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  function addLog(level: BackupLog["level"], message: string) {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString("it-IT"), level, message }]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  BACKUP — Esporta dati CSV + documenti in un unico ZIP
  // ═══════════════════════════════════════════════════════════════
  async function handleBackup() {
    if (!currentGal || !user) return;
    setBackingUp(true);
    setLogs([]);
    setProgress(0);

    const zip = new JSZip();
    const csvFolder = zip.folder("tabelle");
    const storageZipFolder = zip.folder("allegati");
    const tableCounts: { name: string; count: number }[] = [];
    // Salva i dati esportati per estrarre i path degli allegati
    const exportedData: Record<string, Record<string, unknown>[]> = {};
    const totalSteps = GAL_TABLES.length + 3;
    let step = 0;
    let totalRecords = 0;

    try {
      // ── 1. Esporta tutte le tabelle come CSV ────────────────
      addLog("info", `Inizio backup per GAL: ${currentGal.nome}`);

      for (const table of GAL_TABLES) {
        step++;
        setProgress(Math.round((step / totalSteps) * 80));
        setProgressLabel(`Esportazione ${table}...`);

        try {
          // Database di un solo GAL: si esporta tutto, a blocchi da 1000 righe
          // (Supabase restituisce al massimo 1000 righe per richiesta)
          const rows: Record<string, unknown>[] = [];
          let error: { message: string } | null = null;
          for (let da = 0; ; da += 1000) {
            const res = await supabase.from(table).select("*").range(da, da + 999);
            if (res.error) { error = res.error; break; }
            rows.push(...((res.data ?? []) as Record<string, unknown>[]));
            if (!res.data || res.data.length < 1000) break;
          }
          if (error) {
            addLog("warn", `${table}: ${messaggioErrore(error)}`);
            tableCounts.push({ name: table, count: 0 });
          } else {
            tableCounts.push({ name: table, count: rows.length });
            totalRecords += rows.length;
            exportedData[table] = rows;
            if (rows.length > 0 && csvFolder) {
              const csv = arrayToCsv(rows);
              csvFolder.file(`${table}.csv`, csv);
            }
            addLog("info", `${table}: ${rows.length} record`);
          }
        } catch {
          addLog("warn", `${table}: tabella non accessibile (ignorata)`);
          tableCounts.push({ name: table, count: 0 });
        }
      }

      addLog("success", `Tabelle esportate: ${tableCounts.filter((t) => t.count > 0).length}/${GAL_TABLES.length} — Totale record: ${totalRecords}`);

      // ── 2. Esporta allegati dallo storage (dai path nei record) ──
      step++;
      setProgress(85);
      setProgressLabel("Raccolta allegati dallo storage...");

      let docCount = 0;
      let docErrors = 0;

      // Raccoglie tutti i path dai dati appena esportati
      const storagePaths: string[] = [];
      for (const [table, fields] of Object.entries(STORAGE_PATH_FIELDS)) {
        const rows = exportedData[table] ?? [];
        for (const row of rows) {
          for (const field of fields) {
            const path = row[field];
            if (typeof path === "string" && path.trim()) {
              storagePaths.push(path);
            }
          }
        }
      }

      // Allegati delle pratiche dell'Agenda: cartelle agenda/<id pratica>/
      for (const pr of exportedData["gal_agenda_pratiche"] ?? []) {
        const cartella = `agenda/${String(pr.id)}`;
        const { data: elenco } = await supabase.storage.from(STORAGE_BUCKET).list(cartella);
        for (const f of elenco ?? []) if (f.name && f.id) storagePaths.push(`${cartella}/${f.name}`);
      }

      addLog("info", `Allegati da scaricare: ${storagePaths.length}`);

      for (let i = 0; i < storagePaths.length; i++) {
        const path = storagePaths[i];
        setProgressLabel(`Download allegato ${i + 1}/${storagePaths.length}...`);
        try {
          const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
          if (error) {
            addLog("warn", `Errore download: ${path} — ${error.message}`);
            docErrors++;
          } else if (data && storageZipFolder) {
            storageZipFolder.file(path, data);
            docCount++;
          }
        } catch {
          addLog("warn", `Allegato non scaricabile: ${path}`);
          docErrors++;
        }
      }

      addLog("success", `Allegati scaricati: ${docCount}${docErrors > 0 ? ` (${docErrors} errori)` : ""}`);

      // ── 3. Crea il file ZIP ─────────────────────────────────
      setProgress(90);
      setProgressLabel("Creazione archivio ZIP...");

      const metadata = {
        version: "2.0",
        app: "GAL-OS",
        gal_id: currentGal.id,
        gal_nome: currentGal.nome,
        created_at: new Date().toISOString(),
        created_by: user.nome_completo,
        tables: tableCounts,
        total_records: totalRecords,
        documents_count: docCount,
      };

      zip.file("metadata.json", JSON.stringify(metadata, null, 2));

      const blob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setProgress(90 + Math.round(meta.percent * 0.1));
      });

      // Download
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().slice(0, 10);
      const galSlug = currentGal.nome.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
      a.download = `backup_${galSlug}_${dateStr}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);

      setProgress(100);
      addLog("success", `Backup completato: ${(blob.size / 1024 / 1024).toFixed(1)} MB — ${totalRecords} record, ${docCount} allegati`);
      await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "BACKUP", entita: "sistema", descrizione: `Backup completo: ${totalRecords} record, ${docCount} documenti` });
      toast.success("Backup completato e scaricato");
    } catch (err) {
      addLog("error", `Errore backup: ${err instanceof Error ? err.message : String(err)}`);
      toast.error("Errore durante il backup");
    }

    setBackingUp(false);
  }

  // ═══════════════════════════════════════════════════════════════
  //  RIPRISTINO — Importa dati CSV + documenti da ZIP
  // ═══════════════════════════════════════════════════════════════
  async function handleRestore() {
    if (!restoreFile || !user) return;
    setRestoring(true);
    setLogs([]);
    setProgress(0);
    setConfirmRestore(false);

    try {
      addLog("info", "Lettura archivio di backup...");
      setProgressLabel("Lettura archivio ZIP...");

      const zip = await JSZip.loadAsync(restoreFile);

      // Verifica metadata
      const metaFile = zip.file("metadata.json");
      if (!metaFile) {
        addLog("error", "File metadata.json non trovato nel backup. Backup non valido.");
        toast.error("Backup non valido: metadata.json mancante");
        setRestoring(false);
        return;
      }

      const metadata = JSON.parse(await metaFile.async("text"));
      addLog("info", `Backup del ${metadata.created_at} — GAL: ${metadata.gal_nome} — Creato da: ${metadata.created_by}`);

      // Edizione per singolo GAL: tutti i dati vengono assegnati all'unico GAL di questa
      // installazione. Le righe di altri GAL eventualmente presenti nel backup sono scartate.
      if (!currentGal) {
        addLog("error", "Dati del GAL non caricati: ricarica la pagina e riprova.");
        setRestoring(false);
        return;
      }
      const targetGalId: string = currentGal.id;
      const galOrigine: string | null = metadata.gal_id ?? null;
      addLog("info", `I dati del GAL "${metadata.gal_nome ?? "?"}" verranno importati in "${currentGal.nome}".`);

      // ── Leggi CSV o data.json (compatibilità v1) ──
      let backupData: Record<string, Record<string, unknown>[]> = {};

      // Prova prima i CSV (v2)
      const csvDir = zip.folder("tabelle");
      let csvCount = 0;
      if (csvDir) {
        const csvFiles: { name: string; file: JSZip.JSZipObject }[] = [];
        csvDir.forEach((relativePath, file) => {
          if (!file.dir && relativePath.endsWith(".csv")) csvFiles.push({ name: relativePath.replace(".csv", ""), file });
        });
        for (const { name, file } of csvFiles) {
          const text = await file.async("text");
          const rows = csvToArray(text);
          if (rows.length > 0) {
            backupData[name] = rows;
            csvCount++;
          }
        }
      }

      // Fallback a data.json (v1)
      if (csvCount === 0) {
        const dataFile = zip.file("data.json");
        if (dataFile) {
          backupData = JSON.parse(await dataFile.async("text"));
          addLog("info", "Backup v1 (data.json) rilevato");
        } else {
          addLog("error", "Nessun dato trovato nel backup (né CSV né data.json).");
          toast.error("Backup non valido");
          setRestoring(false);
          return;
        }
      } else {
        addLog("info", `${csvCount} file CSV trovati nel backup`);
      }

      const totalTables = Object.keys(backupData).filter((t) => (backupData[t]?.length ?? 0) > 0).length;
      let step = 0;

      // ── 1. Ripristina le tabelle (ordine FK) ────────────────
      const orderedTables = [
        "gal_gal", "gal_profili",
        "gal_bandi", "gal_domande_sostegno", "gal_pagamenti_bando",
        "gal_soci", "gal_quote_sociali",
        "gal_organi", "gal_componenti", "gal_sedute", "gal_delibere",
        "gal_fornitori",
        "gal_periodi_ses", "gal_interventi", "gal_tipologie_spesa", "gal_capitoli",
        "gal_voci_previsione",
        "gal_procedure", "gal_procedure_invitati", "gal_contratti",
        "gal_giustificativi", "gal_pagamenti_giust", "gal_righe_imputazione", "gal_documenti_giustificativo",
        "gal_fascicoli",
        "gal_agenda_pratiche", "gal_agenda_checklist", "gal_agenda_note",
        "gal_conti", "gal_scadenze_pagamento", "gal_movimenti_cassa",
        "gal_audit",
      ];

      // Includi anche tabelle nel backup che non sono nell'ordine predefinito
      const extraTables = Object.keys(backupData).filter((t) => !orderedTables.includes(t));
      const allTablesToRestore = [...orderedTables, ...extraTables];
      const totalSteps = totalTables + 2;

      // Colonne che puntano agli utenti del vecchio sistema: gli utenti di questa
      // installazione sono diversi (creati su invito), quindi il riferimento si azzera
      const COLONNE_UTENTE = ["created_by"];

      for (const table of allTablesToRestore) {
        if (!backupData[table] || backupData[table].length === 0) continue;
        if (table === "gal_profili") {
          addLog("info", "Utenti: non importati (in questa installazione si creano su invito da Supabase)");
          continue;
        }
        step++;
        setProgress(Math.round((step / totalSteps) * 80));
        setProgressLabel(`Ripristino ${table} (${backupData[table].length} record)...`);

        try {
          // Nei CSV i valori mancanti sono stringhe vuote: tornano NULL
          const pulisci = (row: Record<string, unknown>) => {
            const r: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(row)) r[k] = v === "" ? null : v;
            return r;
          };
          let righe = backupData[table].map(pulisci);

          // Solo le righe del GAL di origine (o senza GAL)
          righe = righe.filter((r) => !("gal_id" in r) || r.gal_id === null || !galOrigine || r.gal_id === galOrigine);
          for (const r of righe) {
            if ("gal_id" in r) r.gal_id = targetGalId;
            for (const c of COLONNE_UTENTE) if (c in r) r[c] = null;
          }

          if (table === "gal_gal") {
            // Anagrafica: aggiorna la riga unica di questa installazione
            const g = righe.find((r) => !galOrigine || r.id === galOrigine) ?? righe[0];
            const campi = ["nome", "codice", "codice_fiscale", "partita_iva", "regione", "indirizzo", "email", "pec", "telefono", "sito_web"];
            const patch: Record<string, unknown> = {};
            for (const c of campi) if (g && g[c] !== undefined && g[c] !== null) patch[c] = g[c];
            const { error } = await supabase.from("gal_gal").update(patch).eq("id", targetGalId);
            addLog(error ? "warn" : "success", error ? `Dati del GAL: ${messaggioErrore(error)}` : "Dati del GAL aggiornati");
            continue;
          }

          if (table === "gal_audit") {
            // Lo storico si importa con una funzione del database (solo amministratore)
            const { data: n, error } = await supabase.rpc("gal_importa_registro_attivita", { p_righe: righe });
            addLog(error ? "warn" : "success", error ? `Registro attività: ${messaggioErrore(error)}` : `Registro attività: ${n ?? righe.length} eventi importati`);
            continue;
          }

          if (table === "gal_scadenze_pagamento") {
            // Prima i pagamenti di origine, poi gli F24 che li richiamano
            righe.sort((a, b) => Number(!!a.scadenza_origine_id) - Number(!!b.scadenza_origine_id));
          }

          let ok = 0;
          let errori = 0;
          for (let i = 0; i < righe.length; i += 500) {
            const blocco = righe.slice(i, i + 500);
            const { error } = await supabase.from(table).upsert(blocco, { onConflict: "id" });
            if (error) {
              errori += blocco.length;
              addLog("warn", `${table}: ${messaggioErrore(error)}`);
            } else ok += blocco.length;
          }
          if (ok) addLog("success", `${table}: ${ok} record ripristinati${errori ? `, ${errori} non importati` : ""}`);
        } catch {
          addLog("warn", `${table}: errore durante il ripristino`);
        }
      }

      // ── 2. Ripristina allegati nello storage ────────────────
      step++;
      setProgress(85);
      setProgressLabel("Ripristino allegati nello storage...");

      // Supporta sia "allegati" (v2) che "storage" (v1)
      const storageFolder = zip.folder("allegati") ?? zip.folder("storage");
      let docRestored = 0;
      let docErrors = 0;

      if (storageFolder) {
        const files: { path: string; file: JSZip.JSZipObject }[] = [];
        storageFolder.forEach((relativePath, file) => {
          if (!file.dir) files.push({ path: relativePath, file });
        });

        addLog("info", `Allegati da ripristinare: ${files.length}`);

        for (let i = 0; i < files.length; i++) {
          const { path, file } = files[i];
          setProgressLabel(`Upload allegato ${i + 1}/${files.length}...`);

          try {
            const content = await file.async("blob");
            const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, content, { upsert: true });
            if (error) {
              addLog("warn", `Upload fallito: ${path} — ${error.message}`);
              docErrors++;
            } else {
              docRestored++;
            }
          } catch {
            docErrors++;
          }
        }

        addLog("info", `Allegati ripristinati: ${docRestored}${docErrors > 0 ? `, errori: ${docErrors}` : ""}`);
      } else {
        addLog("info", "Nessun allegato trovato nel backup");
      }

      // ── 3. Finalizzazione ───────────────────────────────────
      setProgress(100);
      addLog("success", `Ripristino completato!`);
      await logAudit({ galId: targetGalId, userId: user.id, username: user.nome_completo, azione: "RESTORE", entita: "sistema", descrizione: `Ripristino da backup del ${metadata.created_at}: ${docRestored} allegati` });
      toast.success("Ripristino completato con successo");
      {
        const { data: galRow } = await supabase.from("gal_gal").select("*").eq("id", targetGalId).maybeSingle();
        if (galRow) {
          setCurrentGal(galRow as Gal);
          addLog("success", `GAL "${(galRow as Gal).nome}" creato e selezionato. Ricaricamento...`);
          setTimeout(() => window.location.reload(), 1500);
        }
      }
    } catch (err) {
      addLog("error", `Errore ripristino: ${err instanceof Error ? err.message : String(err)}`);
      toast.error("Errore durante il ripristino");
    }

    setRestoring(false);
    setRestoreFile(null);
  }

  const isWorking = backingUp || restoring;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Backup & Ripristino</h1>
        <p className="text-sm text-gray-500">Esporta e importa tutti i dati e documenti del GAL</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* ── BACKUP ────────────────────────────────────────── */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Database size={20} className="text-green-700" />
            </div>
            <div>
              <h2 className="font-semibold">Crea Backup</h2>
              <p className="text-xs text-gray-500">Esporta dati e documenti in un file ZIP</p>
            </div>
          </div>

          <div className="bg-green-50 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium text-green-800">Il backup include:</p>
            <ul className="text-green-700 space-y-1 text-xs">
              <li>&#10003; Tutti i dati del GAL ({GAL_TABLES.length} tabelle)</li>
              <li>&#10003; Documenti allegati (fatture, contratti, verbali)</li>
              <li>&#10003; Configurazioni e lookup (interventi, capitoli, periodi)</li>
              <li>&#10003; Storico audit e pagamenti</li>
            </ul>
          </div>

          <button
            onClick={handleBackup}
            disabled={isWorking || !currentGal}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {backingUp ? <><Loader2 size={16} className="animate-spin" /> Backup in corso...</> : <><Download size={16} /> Scarica backup completo</>}
          </button>
        </div>

        {/* ── RIPRISTINO ────────────────────────────────────── */}
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <HardDrive size={20} className="text-blue-700" />
            </div>
            <div>
              <h2 className="font-semibold">Ripristina Backup</h2>
              <p className="text-xs text-gray-500">Importa dati e documenti da un file ZIP</p>
            </div>
          </div>

          <div className="bg-amber-50 rounded-lg p-4 text-sm space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-800">Attenzione</p>
                <p className="text-amber-700 text-xs">Il ripristino sovrascrive i dati esistenti con quelli del backup. Questa operazione non è reversibile. Si consiglia di effettuare un backup dei dati attuali prima di procedere.</p>
              </div>
            </div>
          </div>

          <div>
            <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition">
              <FileArchive size={20} className="text-gray-400" />
              <span className="text-sm text-gray-600">{restoreFile ? restoreFile.name : "Seleziona file backup (.zip)"}</span>
              <input
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                disabled={isWorking}
              />
            </label>
            {restoreFile && (
              <p className="text-xs text-gray-500 mt-1 text-center">
                {(restoreFile.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
          </div>

          <button
            onClick={() => setConfirmRestore(true)}
            disabled={isWorking || !restoreFile}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
          >
            {restoring ? <><Loader2 size={16} className="animate-spin" /> Ripristino in corso...</> : <><Upload size={16} /> Ripristina da backup</>}
          </button>
        </div>
      </div>

      {/* ── PROGRESS BAR ──────────────────────────────────────── */}
      {isWorking && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{progressLabel}</span>
            <span className="text-gray-500">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-green-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* ── LOG ────────────────────────────────────────────────── */}
      {logs.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-3">Log operazione</h3>
          <div className="max-h-64 overflow-y-auto space-y-1 font-mono text-xs">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-2 ${
                log.level === "error" ? "text-red-600" :
                log.level === "warn" ? "text-amber-600" :
                log.level === "success" ? "text-green-600" : "text-gray-600"
              }`}>
                <span className="text-gray-400 flex-shrink-0">{log.time}</span>
                <span>
                  {log.level === "success" && <CheckCircle size={12} className="inline mr-1" />}
                  {log.level === "error" && <AlertTriangle size={12} className="inline mr-1" />}
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRestore}
        onCancel={() => setConfirmRestore(false)}
        onConfirm={handleRestore}
        title="Conferma ripristino"
        message={`Stai per ripristinare i dati dal file "${restoreFile?.name}". I dati esistenti con lo stesso ID verranno sovrascritti. Vuoi procedere?`}
        confirmLabel="Ripristina"
        danger
      />
    </div>
  );
}
