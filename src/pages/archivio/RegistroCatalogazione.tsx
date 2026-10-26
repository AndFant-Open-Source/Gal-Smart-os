// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { logAudit, messaggioErrore } from "../../lib/utils";
import { generateTablePdf } from "../../lib/pdf";
import { toast } from "sonner";
import { Plus, Search, Download, Upload, FileSpreadsheet, FileText, Archive } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import * as XLSX from "xlsx";
import type { Fascicolo } from "../../types";

const FORM_INIT = {
  numero_fascicolo: "", ragione_sociale: "",
  indirizzo: "", cap: "", comune: "", provincia: "",
  codice_fiscale: "", partita_iva: "", note: "",
};

type FormState = typeof FORM_INIT;
type FormErrors = Partial<Record<keyof FormState, string>>;

const TEMPLATE_COLUMNS = ["N. Fascicolo", "Ragione Sociale", "Indirizzo", "CAP", "Comune", "Provincia", "Codice Fiscale", "Partita IVA", "Note"];
const TEMPLATE_EXAMPLE = ["1", "Esempio S.r.l.", "Via Roma, 1", "01100", "Viterbo", "VT", "01234567897", "01234567897", ""];

// ─── Validazioni ────────────────────────────────────────────────────

/** Partita IVA italiana: 11 cifre con cifra di controllo */
function isPartitaIvaValida(piva: string): boolean {
  if (!/^\d{11}$/.test(piva)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let n = Number(piva[i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Codice fiscale: 16 caratteri (persona fisica) oppure 11 cifre (società/ente) */
function isCodiceFiscaleValido(cf: string): boolean {
  if (/^\d{11}$/.test(cf)) return isPartitaIvaValida(cf);
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
  const DISPARI: Record<string, number> = {
    "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
    N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
  };
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = cf[i];
    if (i % 2 === 0) sum += DISPARI[c];
    else sum += /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

function validate(form: FormState, fascicoli: Fascicolo[], editId: string | null): FormErrors {
  const errors: FormErrors = {};
  const numero = form.numero_fascicolo.trim();
  if (!numero) errors.numero_fascicolo = "Il numero del fascicolo è obbligatorio";
  else if (fascicoli.some((f) => f.id !== editId && f.numero_fascicolo.trim().toLowerCase() === numero.toLowerCase())) {
    errors.numero_fascicolo = "Esiste già un fascicolo con questo numero";
  }
  if (!form.ragione_sociale.trim()) errors.ragione_sociale = "La ragione sociale è obbligatoria";
  if (form.cap && !/^\d{5}$/.test(form.cap)) errors.cap = "Il CAP deve avere 5 cifre";
  if (form.provincia && !/^[A-Z]{2}$/.test(form.provincia)) errors.provincia = "Usa la sigla di 2 lettere (es. VT)";
  if (form.codice_fiscale && !isCodiceFiscaleValido(form.codice_fiscale)) {
    errors.codice_fiscale = "Codice fiscale non valido (16 caratteri oppure 11 cifre)";
  }
  if (form.partita_iva && !isPartitaIvaValida(form.partita_iva)) errors.partita_iva = "Partita IVA non valida (11 cifre)";
  return errors;
}

/** "Via Roma 1, 01100 Viterbo (VT)" */
function indirizzoCompleto(f: Pick<Fascicolo, "indirizzo" | "cap" | "comune" | "provincia">): string {
  const localita = [f.cap, f.comune].filter(Boolean).join(" ");
  const conProv = f.provincia ? `${localita}${localita ? " " : ""}(${f.provincia})` : localita;
  return [f.indirizzo, conProv].filter((p) => p && p.trim()).join(", ");
}

/** Ordinamento naturale dei numeri di fascicolo (2 prima di 10, "12/A" dopo "12") */
function compareNumero(a: string, b: string): number {
  return a.localeCompare(b, "it", { numeric: true, sensitivity: "base" });
}

function prossimoNumero(fascicoli: Fascicolo[]): string {
  const numeri = fascicoli.map((f) => parseInt(f.numero_fascicolo, 10)).filter((n) => !Number.isNaN(n));
  return String(numeri.length ? Math.max(...numeri) + 1 : 1);
}

const cellText = (v: string | number | undefined) => String(v ?? "").trim();

export default function RegistroCatalogazione() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fascicoli, setFascicoli] = useState<Fascicolo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Fascicolo | null>(null);
  const [form, setForm] = useState<FormState>(FORM_INIT);
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Fascicolo | null>(null);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    const { data, error } = await supabase.from("gal_fascicoli").select("*").eq("gal_id", currentGal.id);
    if (error) toast.error(messaggioErrore(error, "Impossibile caricare il registro"));
    const rows = ((data ?? []) as Fascicolo[]).sort((a, b) => compareNumero(a.numero_fascicolo, b.numero_fascicolo));
    setFascicoli(rows);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return fascicoli;
    return fascicoli.filter((f) =>
      [f.numero_fascicolo, f.ragione_sociale, f.codice_fiscale ?? "", f.partita_iva ?? "", indirizzoCompleto(f)]
        .some((v) => v.toLowerCase().includes(s))
    );
  }, [fascicoli, search]);

  const errors = validate(form, fascicoli, editItem?.id ?? null);
  const showError = (k: keyof FormState) => (touched[k] ? errors[k] : undefined);
  const setField = (k: keyof FormState, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setTouched((t) => ({ ...t, [k]: true }));
  };

  function openCreate() {
    setEditItem(null);
    setForm({ ...FORM_INIT, numero_fascicolo: prossimoNumero(fascicoli) });
    setTouched({});
    setShowModal(true);
  }

  function openEdit(f: Fascicolo) {
    setEditItem(f);
    setForm({
      numero_fascicolo: f.numero_fascicolo,
      ragione_sociale: f.ragione_sociale,
      indirizzo: f.indirizzo ?? "",
      cap: f.cap ?? "",
      comune: f.comune ?? "",
      provincia: f.provincia ?? "",
      codice_fiscale: f.codice_fiscale ?? "",
      partita_iva: f.partita_iva ?? "",
      note: f.note ?? "",
    });
    setTouched({});
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    if (Object.keys(errors).length > 0) {
      setTouched(Object.fromEntries(Object.keys(FORM_INIT).map((k) => [k, true])));
      toast.error("Controlla i campi evidenziati");
      return;
    }
    setSaving(true);
    const payload = {
      gal_id: currentGal.id,
      numero_fascicolo: form.numero_fascicolo.trim(),
      ragione_sociale: form.ragione_sociale.trim(),
      indirizzo: form.indirizzo.trim() || null,
      cap: form.cap.trim() || null,
      comune: form.comune.trim() || null,
      provincia: form.provincia.trim() || null,
      codice_fiscale: form.codice_fiscale.trim() || null,
      partita_iva: form.partita_iva.trim() || null,
      note: form.note.trim() || null,
    };
    const { error } = editItem
      ? await supabase.from("gal_fascicoli").update(payload).eq("id", editItem.id)
      : await supabase.from("gal_fascicoli").insert(payload);
    if (error) { toast.error(messaggioErrore(error, "Errore nel salvataggio")); setSaving(false); return; }
    await logAudit({
      galId: currentGal.id, userId: user.id, username: user.nome_completo,
      azione: editItem ? "UPDATE" : "CREATE", entita: "fascicolo",
      descrizione: `Fascicolo n. ${payload.numero_fascicolo} - ${payload.ragione_sociale}`,
    });
    toast.success(editItem ? "Fascicolo aggiornato" : "Fascicolo aggiunto al registro");
    setShowModal(false); setSaving(false); setEditItem(null); setForm(FORM_INIT); load();
  }

  async function handleDelete(f: Fascicolo) {
    if (!currentGal || !user) return;
    const { error } = await supabase.from("gal_fascicoli").delete().eq("id", f.id);
    if (error) { toast.error(messaggioErrore(error, "Errore nell'eliminazione")); return; }
    await logAudit({
      galId: currentGal.id, userId: user.id, username: user.nome_completo,
      azione: "DELETE", entita: "fascicolo", descrizione: `Fascicolo n. ${f.numero_fascicolo} - ${f.ragione_sociale}`,
    });
    toast.success("Fascicolo eliminato");
    setDeleteConfirm(null); load();
  }

  function handleExportExcel() {
    const rows = filtered.map((f) => ({
      "N. Fascicolo": f.numero_fascicolo,
      "Ragione Sociale": f.ragione_sociale,
      "Indirizzo completo": indirizzoCompleto(f),
      "Indirizzo": f.indirizzo ?? "",
      "CAP": f.cap ?? "",
      "Comune": f.comune ?? "",
      "Provincia": f.provincia ?? "",
      "Codice Fiscale": f.codice_fiscale ?? "",
      "Partita IVA": f.partita_iva ?? "",
      "Note": f.note ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 50 }, { wch: 30 }, { wch: 8 }, { wch: 20 }, { wch: 9 }, { wch: 18 }, { wch: 14 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registro catalogazione");
    XLSX.writeFile(wb, `registro_catalogazione_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function handleExportPdf() {
    generateTablePdf(
      [
        { header: "N. Fascicolo", dataKey: "numero", width: 22 },
        { header: "Ragione sociale", dataKey: "ragione_sociale", width: 70 },
        { header: "Indirizzo completo", dataKey: "indirizzo" },
        { header: "Codice fiscale", dataKey: "codice_fiscale", width: 38 },
        { header: "Partita IVA", dataKey: "partita_iva", width: 28 },
      ],
      filtered.map((f) => ({
        numero: f.numero_fascicolo,
        ragione_sociale: f.ragione_sociale,
        indirizzo: indirizzoCompleto(f) || "-",
        codice_fiscale: f.codice_fiscale ?? "-",
        partita_iva: f.partita_iva ?? "-",
      })),
      {
        title: "Registro di catalogazione",
        subtitle: `Elenco dei fascicoli contenuti nell'archivio — ${filtered.length} fascicoli`,
        galNome: currentGal?.nome,
        orientation: "landscape",
        filename: `registro_catalogazione_${new Date().toISOString().slice(0, 10)}.pdf`,
      }
    );
  }

  function handleDownloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS, TEMPLATE_EXAMPLE]);
    ws["!cols"] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(c.length + 2, 16) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fascicoli");
    XLSX.writeFile(wb, "template_registro_catalogazione.xlsx");
    toast.success("Template scaricato");
  }

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file || !currentGal || !user) return;
    setImporting(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      if (!sheet) { toast.error("Il file Excel non contiene fogli"); return; }
      const rows = XLSX.utils.sheet_to_json<Record<string, string | number | undefined>>(sheet);

      const esistenti = new Set(fascicoli.map((f) => f.numero_fascicolo.trim().toLowerCase()));
      const scartate: string[] = [];
      const payloads: Omit<Fascicolo, "id" | "created_at" | "updated_at">[] = [];
      rows.forEach((row, i) => {
        const riga = i + 2;
        const numero = cellText(row["N. Fascicolo"]);
        const ragione = cellText(row["Ragione Sociale"]);
        if (!numero && !ragione) return;
        const cf = cellText(row["Codice Fiscale"]).toUpperCase().replace(/\s/g, "");
        const piva = cellText(row["Partita IVA"]).replace(/\s/g, "").padStart(cellText(row["Partita IVA"]) ? 11 : 0, "0");
        const cap = cellText(row["CAP"]).padStart(cellText(row["CAP"]) ? 5 : 0, "0");
        if (!numero || !ragione) { scartate.push(`riga ${riga}: numero o ragione sociale mancante`); return; }
        if (esistenti.has(numero.toLowerCase())) { scartate.push(`riga ${riga}: fascicolo n. ${numero} già presente`); return; }
        if (cf && !isCodiceFiscaleValido(cf)) { scartate.push(`riga ${riga}: codice fiscale non valido`); return; }
        if (piva && !isPartitaIvaValida(piva)) { scartate.push(`riga ${riga}: partita IVA non valida`); return; }
        esistenti.add(numero.toLowerCase());
        payloads.push({
          gal_id: currentGal.id,
          numero_fascicolo: numero,
          ragione_sociale: ragione,
          indirizzo: cellText(row["Indirizzo"]) || null,
          cap: cap || null,
          comune: cellText(row["Comune"]) || null,
          provincia: cellText(row["Provincia"]).toUpperCase() || null,
          codice_fiscale: cf || null,
          partita_iva: piva || null,
          note: cellText(row["Note"]) || null,
        });
      });

      if (payloads.length === 0) {
        toast.error(scartate.length ? `Nessuna riga importata. ${scartate.slice(0, 3).join("; ")}` : "Il file non contiene fascicoli");
        return;
      }
      const { error } = await supabase.from("gal_fascicoli").insert(payloads);
      if (error) { toast.error(messaggioErrore(error, "Errore nell'importazione")); return; }
      await logAudit({
        galId: currentGal.id, userId: user.id, username: user.nome_completo,
        azione: "CREATE", entita: "fascicolo", descrizione: `Importazione Excel: ${payloads.length} fascicoli`,
      });
      toast.success(`Importati ${payloads.length} fascicoli`);
      if (scartate.length) {
        toast.warning(`${scartate.length} righe non importate: ${scartate.slice(0, 3).join("; ")}${scartate.length > 3 ? "…" : ""}`, { duration: 10000 });
      }
      load();
    } catch {
      toast.error("Impossibile leggere il file Excel. Usa il template scaricabile.");
    } finally {
      setImporting(false);
    }
  }

  const columns: Column<Fascicolo>[] = [
    { key: "numero_fascicolo", label: "N. Fascicolo", width: "w-28", render: (r) => <span className="font-mono font-semibold">{r.numero_fascicolo}</span> },
    { key: "ragione_sociale", label: "Ragione sociale" },
    { key: "indirizzo", label: "Indirizzo completo", render: (r) => indirizzoCompleto(r) || "-" },
    { key: "codice_fiscale", label: "Codice fiscale", render: (r) => <span className="font-mono text-xs">{r.codice_fiscale ?? "-"}</span> },
    { key: "partita_iva", label: "Partita IVA", render: (r) => <span className="font-mono text-xs">{r.partita_iva ?? "-"}</span> },
    ...(write ? [{ key: "id" as keyof Fascicolo, label: "", render: (r: Fascicolo) => (
      <div className="flex gap-1">
        <button className="btn-ghost p-1 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Modifica</button>
        {admin && <button className="btn-ghost p-1 text-xs text-red-500" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(r); }}>Elimina</button>}
      </div>
    ) }] : []),
  ];

  const fieldClass = (k: keyof FormState, extra = "") => `input ${extra} ${showError(k) ? "border-red-400 focus:ring-red-300" : ""}`;
  const errorText = (k: keyof FormState) => showError(k) ? <p className="text-xs text-red-600 mt-1">{showError(k)}</p> : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-50 text-green-700"><Archive size={22} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Registro di catalogazione</h1>
            <p className="text-sm text-gray-500">Elenco dei fascicoli contenuti nell'archivio · {filtered.length} fascicoli</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary" onClick={handleExportPdf} disabled={filtered.length === 0}><FileText size={16} /> Stampa PDF</button>
          <button className="btn-secondary" onClick={handleExportExcel} disabled={filtered.length === 0}><Download size={16} /> Export Excel</button>
          {write && (
            <>
              <button className="btn-secondary" onClick={handleDownloadTemplate}><FileSpreadsheet size={16} /> Template</button>
              <button className="btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                <Upload size={16} /> {importing ? "Importazione..." : "Importa Excel"}
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} />
              <button className="btn-primary" onClick={openCreate}><Plus size={16} /> Nuovo fascicolo</button>
            </>
          )}
        </div>
      </div>

      <div className="card p-3">
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 text-sm" placeholder="Cerca numero, ragione sociale, C.F., P.IVA, comune..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <Table data={filtered} columns={columns} keyField="id" isLoading={loading} onRowClick={write ? openEdit : undefined} emptyMessage={search ? "Nessun fascicolo corrisponde alla ricerca" : "Il registro è vuoto: aggiungi il primo fascicolo"} />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? `Modifica fascicolo n. ${editItem.numero_fascicolo}` : "Nuovo fascicolo"} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="label">N. fascicolo *</label>
              <input className={fieldClass("numero_fascicolo", "font-mono")} value={form.numero_fascicolo} onChange={(e) => setField("numero_fascicolo", e.target.value)} autoFocus />
              {errorText("numero_fascicolo")}
            </div>
            <div className="col-span-3">
              <label className="label">Ragione sociale della ditta *</label>
              <input className={fieldClass("ragione_sociale")} value={form.ragione_sociale} onChange={(e) => setField("ragione_sociale", e.target.value)} />
              {errorText("ragione_sociale")}
            </div>
          </div>

          <fieldset className="border border-gray-200 rounded-lg p-3 space-y-3">
            <legend className="text-xs font-semibold text-gray-500 px-1">Indirizzo completo</legend>
            <div>
              <label className="label">Via / Piazza e numero civico</label>
              <input className={fieldClass("indirizzo")} placeholder="Via Roma, 1" value={form.indirizzo} onChange={(e) => setField("indirizzo", e.target.value)} />
            </div>
            <div className="grid grid-cols-6 gap-3">
              <div>
                <label className="label">CAP</label>
                <input className={fieldClass("cap", "font-mono")} maxLength={5} inputMode="numeric" value={form.cap} onChange={(e) => setField("cap", e.target.value.replace(/\D/g, ""))} />
                {errorText("cap")}
              </div>
              <div className="col-span-4">
                <label className="label">Comune</label>
                <input className={fieldClass("comune")} value={form.comune} onChange={(e) => setField("comune", e.target.value)} />
              </div>
              <div>
                <label className="label">Prov.</label>
                <input className={fieldClass("provincia")} maxLength={2} value={form.provincia} onChange={(e) => setField("provincia", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
                {errorText("provincia")}
              </div>
            </div>
            {indirizzoCompleto(form) && <p className="text-xs text-gray-500">Anteprima: <span className="text-gray-700">{indirizzoCompleto(form)}</span></p>}
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Codice fiscale</label>
              <input className={fieldClass("codice_fiscale", "font-mono")} maxLength={16} value={form.codice_fiscale} onChange={(e) => setField("codice_fiscale", e.target.value.toUpperCase().replace(/\s/g, ""))} />
              {errorText("codice_fiscale")}
            </div>
            <div>
              <label className="label">Partita IVA</label>
              <input className={fieldClass("partita_iva", "font-mono")} maxLength={11} inputMode="numeric" value={form.partita_iva} onChange={(e) => setField("partita_iva", e.target.value.replace(/\D/g, ""))} />
              {errorText("partita_iva")}
            </div>
          </div>
          {form.partita_iva && !form.codice_fiscale && isPartitaIvaValida(form.partita_iva) && (
            <button type="button" className="text-xs text-blue-600 hover:underline -mt-2" onClick={() => setField("codice_fiscale", form.partita_iva)}>
              Usa la partita IVA anche come codice fiscale
            </button>
          )}

          <div>
            <label className="label">Note</label>
            <textarea className="input" rows={2} value={form.note} onChange={(e) => setField("note", e.target.value)} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "Salvataggio..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirm}
        title="Elimina fascicolo"
        message={`Eliminare dal registro il fascicolo n. ${deleteConfirm?.numero_fascicolo} (${deleteConfirm?.ragione_sociale})? L'operazione non si può annullare.`}
        confirmLabel="Elimina"
        danger
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
