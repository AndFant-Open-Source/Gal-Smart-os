// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { logAudit, messaggioErrore } from "../../lib/utils";
import { toast } from "sonner";
import { Plus, Search } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import type { Fornitore } from "../../types";

const FORM_INIT = {
  denominazione: "", codice_fiscale: "", partita_iva: "",
  indirizzo: "", comune: "", provincia: "", iban: "",
  email: "", pec: "", telefono: "", note: "",
};

export default function FornitoriList() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);
  const admin = isAdmin(user);

  const [fornitori, setFornitori] = useState<Fornitore[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Fornitore | null>(null);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Fornitore | null>(null);

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    const { data } = await supabase.from("gal_fornitori").select("*").eq("gal_id", currentGal.id).order("denominazione");
    setFornitori((data ?? []) as Fornitore[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  const filtered = search
    ? fornitori.filter((f) =>
        [f.denominazione, f.partita_iva ?? "", f.codice_fiscale ?? ""]
          .some((v) => v.toLowerCase().includes(search.toLowerCase()))
      )
    : fornitori;

  function openEdit(f: Fornitore) {
    setEditItem(f);
    setForm({
      denominazione: f.denominazione,
      codice_fiscale: f.codice_fiscale ?? "",
      partita_iva: f.partita_iva ?? "",
      indirizzo: f.indirizzo ?? "",
      comune: f.comune ?? "",
      provincia: f.provincia ?? "",
      iban: f.iban ?? "",
      email: f.email ?? "",
      pec: f.pec ?? "",
      telefono: f.telefono ?? "",
      note: f.note ?? "",
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const fullPayload: Record<string, unknown> = {
      gal_id: currentGal.id,
      denominazione: form.denominazione,
      codice_fiscale: form.codice_fiscale || null,
      partita_iva: form.partita_iva || null,
      indirizzo: form.indirizzo || null,
      comune: form.comune || null,
      provincia: form.provincia || null,
      iban: form.iban || null,
      email: form.email || null,
      pec: form.pec || null,
      telefono: form.telefono || null,
      note: form.note || null,
    };
    let error;
    if (editItem) {
      ({ error } = await supabase.from("gal_fornitori").update(fullPayload).eq("id", editItem.id));
    } else {
      ({ error } = await supabase.from("gal_fornitori").insert(fullPayload));
    }
    // Fallback senza colonna note se manca nello schema
    if (error?.message?.includes("schema cache")) {
      const { note: _, ...minPayload } = fullPayload;
      void _;
      if (editItem) {
        ({ error } = await supabase.from("gal_fornitori").update(minPayload).eq("id", editItem.id));
      } else {
        ({ error } = await supabase.from("gal_fornitori").insert(minPayload));
      }
    }
    if (error) { toast.error(messaggioErrore(error)); setSaving(false); return; }
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: editItem ? "UPDATE" : "CREATE", entita: "fornitore", descrizione: form.denominazione });
    toast.success(editItem ? "Fornitore aggiornato" : "Fornitore aggiunto");
    setShowModal(false); setSaving(false); setEditItem(null); setForm(FORM_INIT); load();
  }

  async function handleDelete(f: Fornitore) {
    if (!currentGal || !user) return;
    const { error } = await supabase.from("gal_fornitori").delete().eq("id", f.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    toast.success("Fornitore eliminato");
    setDeleteConfirm(null); load();
  }

  const columns: Column<Fornitore>[] = [
    { key: "denominazione", label: "Denominazione" },
    { key: "partita_iva", label: "P.IVA", render: (r) => <span className="font-mono text-xs">{r.partita_iva ?? "-"}</span> },
    { key: "codice_fiscale", label: "C.F.", render: (r) => <span className="font-mono text-xs">{r.codice_fiscale ?? "-"}</span> },
    { key: "comune", label: "Comune", render: (r) => r.comune ? `${r.comune} (${r.provincia ?? ""})` : "-" },
    { key: "iban", label: "IBAN", render: (r) => r.iban ? <span className="font-mono text-xs">{r.iban}</span> : "-" },
    { key: "email", label: "Email", render: (r) => r.email ?? "-" },
    ...(write ? [{ key: "id" as keyof Fornitore, label: "", render: (r: Fornitore) => (
      <div className="flex gap-1">
        <button className="btn-ghost p-1 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Modifica</button>
        {admin && <button className="btn-ghost p-1 text-xs text-red-500" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(r); }}>Elimina</button>}
      </div>
    ) }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Fornitori</h1>
          <p className="text-sm text-gray-500">{filtered.length} fornitori</p>
        </div>
        {write && <button className="btn-primary" onClick={() => { setEditItem(null); setForm(FORM_INIT); setShowModal(true); }}><Plus size={16} /> Nuovo fornitore</button>}
      </div>

      <div className="card p-3">
        <div className="relative max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 text-sm" placeholder="Cerca denominazione, P.IVA..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <Table data={filtered} columns={columns} keyField="id" isLoading={loading} emptyMessage="Nessun fornitore trovato" />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? "Modifica Fornitore" : "Nuovo Fornitore"} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Denominazione *</label>
            <input className="input" required value={form.denominazione} onChange={(e) => setForm({ ...form, denominazione: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Codice Fiscale</label><input className="input font-mono" value={form.codice_fiscale} onChange={(e) => setForm({ ...form, codice_fiscale: e.target.value.toUpperCase() })} /></div>
            <div><label className="label">Partita IVA</label><input className="input font-mono" value={form.partita_iva} onChange={(e) => setForm({ ...form, partita_iva: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2"><label className="label">Indirizzo</label><input className="input" value={form.indirizzo} onChange={(e) => setForm({ ...form, indirizzo: e.target.value })} /></div>
            <div><label className="label">Prov.</label><input className="input" maxLength={2} value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value.toUpperCase() })} /></div>
          </div>
          <div><label className="label">IBAN</label><input className="input font-mono" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value.toUpperCase() })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="label">PEC</label><input className="input" type="email" value={form.pec} onChange={(e) => setForm({ ...form, pec: e.target.value })} /></div>
          </div>
          <div><label className="label">Note</label><textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? "..." : "Salva"}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!deleteConfirm} title="Elimina fornitore" message={`Eliminare "${deleteConfirm?.denominazione}"?`} confirmLabel="Elimina" danger onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} />
    </div>
  );
}
