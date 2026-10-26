// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useMemo, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";
import { Plus, Pencil, Trash2, Loader2, CheckCircle2, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { formatCurrency, formatDate } from "../../lib/utils";
import { etichettaScadenza, oggiISO } from "../../lib/scadenze";
import { CATEGORIE_ENTRATA, CATEGORIE_USCITA, categoriaMovimentoLabel } from "../../constants";
import Modal from "../ui/Modal";
import ConfirmDialog from "../ui/ConfirmDialog";
import type { ContoCorrente, MovimentoCassa, StatoMovimento, TipoMovimento } from "../../types";

interface Props {
  galId: string;
  movimenti: MovimentoCassa[];
  conti: ContoCorrente[];
  write: boolean;
  admin: boolean;
  onChange: () => void;
}

interface FormMov {
  tipo: TipoMovimento;
  categoria: string;
  descrizione: string;
  controparte: string;
  importo: number;
  data_prevista: string;
  stato: StatoMovimento;
  data_effettiva: string;
  conto_id: string;
  riferimento: string;
  note: string;
}

const VUOTO: FormMov = {
  tipo: "entrata", categoria: "sal", descrizione: "", controparte: "", importo: 0, data_prevista: oggiISO(),
  stato: "previsto", data_effettiva: "", conto_id: "", riferimento: "", note: "",
};

const STATO_COLORS: Record<StatoMovimento, string> = {
  previsto: "bg-blue-100 text-blue-700",
  realizzato: "bg-green-100 text-green-700",
  annullato: "bg-gray-100 text-gray-400",
};

export default function MovimentiTab({ galId, movimenti, conti, write, admin, onChange }: Props) {
  const [filtroTipo, setFiltroTipo] = useState<TipoMovimento | "">("");
  const [filtroStato, setFiltroStato] = useState<StatoMovimento | "">("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<MovimentoCassa | null>(null);
  const [form, setForm] = useState<FormMov>(VUOTO);
  const [saving, setSaving] = useState(false);
  const [daEliminare, setDaEliminare] = useState<MovimentoCassa | null>(null);
  const [daIncassare, setDaIncassare] = useState<MovimentoCassa | null>(null);
  const [incasso, setIncasso] = useState({ data: oggiISO(), conto_id: "", importo: 0 });

  const lista = useMemo(() => movimenti
    .filter((m) => (!filtroTipo || m.tipo === filtroTipo) && (!filtroStato || m.stato === filtroStato))
    .sort((a, b) => (b.data_effettiva ?? b.data_prevista).localeCompare(a.data_effettiva ?? a.data_prevista)),
  [movimenti, filtroTipo, filtroStato]);

  function apri(m: MovimentoCassa | null) {
    setEdit(m);
    setForm(m ? {
      tipo: m.tipo, categoria: m.categoria, descrizione: m.descrizione, controparte: m.controparte ?? "",
      importo: Number(m.importo), data_prevista: m.data_prevista, stato: m.stato, data_effettiva: m.data_effettiva ?? "",
      conto_id: m.conto_id ?? "", riferimento: m.riferimento ?? "", note: m.note ?? "",
    } : { ...VUOTO, data_prevista: oggiISO(), conto_id: conti.find((c) => c.attivo)?.id ?? "" });
    setOpen(true);
  }

  async function salva(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descrizione.trim()) { toast.error("Indica la descrizione"); return; }
    if (form.importo <= 0) { toast.error("L'importo deve essere maggiore di zero"); return; }
    if (form.stato === "realizzato" && !form.data_effettiva) { toast.error("Indica la data effettiva dell'operazione"); return; }
    setSaving(true);
    const payload = {
      tipo: form.tipo, categoria: form.categoria, descrizione: form.descrizione.trim(), controparte: form.controparte || null,
      importo: form.importo, data_prevista: form.data_prevista, stato: form.stato,
      data_effettiva: form.stato === "realizzato" ? form.data_effettiva : null,
      conto_id: form.conto_id || null, riferimento: form.riferimento || null, note: form.note || null,
    };
    const { error } = edit
      ? await supabase.from("gal_movimenti_cassa").update(payload).eq("id", edit.id)
      : await supabase.from("gal_movimenti_cassa").insert({ ...payload, gal_id: galId });
    setSaving(false);
    if (error) { console.error(error); toast.error("Salvataggio non riuscito"); return; }
    toast.success(edit ? "Movimento aggiornato" : "Movimento registrato");
    setOpen(false);
    onChange();
  }

  async function confermaIncasso(e: React.FormEvent) {
    e.preventDefault();
    if (!daIncassare) return;
    if (!incasso.conto_id) { toast.error("Seleziona il conto"); return; }
    const { error } = await supabase.from("gal_movimenti_cassa").update({
      stato: "realizzato", data_effettiva: incasso.data, conto_id: incasso.conto_id, importo: incasso.importo,
    }).eq("id", daIncassare.id);
    if (error) { console.error(error); toast.error("Registrazione non riuscita"); return; }
    toast.success(daIncassare.tipo === "entrata" ? "Incasso registrato" : "Uscita registrata");
    setDaIncassare(null);
    onChange();
  }

  async function elimina() {
    if (!daEliminare) return;
    const { error } = await supabase.from("gal_movimenti_cassa").delete().eq("id", daEliminare.id);
    setDaEliminare(null);
    if (error) { console.error(error); toast.error("Eliminazione non riuscita"); return; }
    toast.success("Movimento eliminato");
    onChange();
  }

  const categorie = form.tipo === "entrata" ? CATEGORIE_ENTRATA : CATEGORIE_USCITA;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2">
          <select className="input w-auto" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoMovimento | "")}>
            <option value="">Entrate e uscite</option>
            <option value="entrata">Solo entrate</option>
            <option value="uscita">Solo uscite</option>
          </select>
          <select className="input w-auto" value={filtroStato} onChange={(e) => setFiltroStato(e.target.value as StatoMovimento | "")}>
            <option value="">Tutti gli stati</option>
            <option value="previsto">Previsti</option>
            <option value="realizzato">Realizzati</option>
            <option value="annullato">Annullati</option>
          </select>
        </div>
        {write && <button className="btn-primary" onClick={() => apri(null)}><Plus size={16} /> Nuovo incasso / movimento</button>}
      </div>
      <p className="text-xs text-gray-500">I pagamenti a fornitori, F24 e stipendi si gestiscono dallo Scadenzario: qui registri incassi (anticipi, SAL, quote soci…) e altri movimenti come commissioni bancarie.</p>

      <div className="card overflow-x-auto">
        {lista.length === 0 ? (
          <div className="p-10 text-center text-gray-400">Nessun movimento registrato</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="table-header text-left">Data</th>
                <th className="table-header text-left">Descrizione</th>
                <th className="table-header text-left">Categoria</th>
                <th className="table-header text-left">Conto</th>
                <th className="table-header text-right">Importo</th>
                <th className="table-header text-left">Stato</th>
                <th className="table-header"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m) => {
                const et = m.stato === "previsto" ? etichettaScadenza(m.data_prevista) : null;
                return (
                  <tr key={m.id} className="border-b border-gray-100">
                    <td className="table-cell whitespace-nowrap">
                      {formatDate(m.data_effettiva ?? m.data_prevista)}
                      {et && <div className={clsx("text-xs", et.classe)}>{et.testo}</div>}
                    </td>
                    <td className="table-cell">
                      <div className="font-medium flex items-center gap-1.5">
                        {m.tipo === "entrata" ? <ArrowDownCircle size={14} className="text-green-600" /> : <ArrowUpCircle size={14} className="text-red-500" />}
                        {m.descrizione}
                      </div>
                      {(m.controparte || m.riferimento) && <div className="text-xs text-gray-400">{[m.controparte, m.riferimento].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td className="table-cell text-xs">{categoriaMovimentoLabel(m.categoria)}</td>
                    <td className="table-cell text-xs">{conti.find((c) => c.id === m.conto_id)?.nome ?? "—"}</td>
                    <td className={clsx("table-cell text-right font-semibold whitespace-nowrap", m.tipo === "entrata" ? "text-green-700" : "text-red-600")}>
                      {m.tipo === "entrata" ? "+" : "−"} {formatCurrency(m.importo)}
                    </td>
                    <td className="table-cell"><span className={clsx("badge", STATO_COLORS[m.stato])}>{m.stato === "previsto" ? "Previsto" : m.stato === "realizzato" ? "Realizzato" : "Annullato"}</span></td>
                    <td className="table-cell text-right whitespace-nowrap">
                      {write && m.stato === "previsto" && (
                        <button className="btn-ghost p-1.5 text-green-700" title={m.tipo === "entrata" ? "Registra incasso" : "Registra uscita"}
                          onClick={() => { setDaIncassare(m); setIncasso({ data: oggiISO(), conto_id: m.conto_id ?? conti.find((c) => c.attivo)?.id ?? "", importo: Number(m.importo) }); }}>
                          <CheckCircle2 size={15} />
                        </button>
                      )}
                      {write && <button className="btn-ghost p-1.5" onClick={() => apri(m)} title="Modifica"><Pencil size={14} /></button>}
                      {admin && <button className="btn-ghost p-1.5 text-red-500" onClick={() => setDaEliminare(m)} title="Elimina"><Trash2 size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={edit ? "Modifica movimento" : "Nuovo incasso / movimento"} size="lg">
        <form onSubmit={salva} className="space-y-3">
          <div className="flex gap-2">
            {(["entrata", "uscita"] as const).map((t) => (
              <button type="button" key={t} onClick={() => setForm({ ...form, tipo: t, categoria: t === "entrata" ? "sal" : "commissioni" })}
                className={clsx("flex-1 py-2 rounded-lg border text-sm font-medium", form.tipo === t
                  ? t === "entrata" ? "bg-green-50 border-green-400 text-green-800" : "bg-red-50 border-red-300 text-red-700"
                  : "border-gray-200 text-gray-500")}>
                {t === "entrata" ? "Entrata / incasso" : "Uscita"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2"><label className="label">Descrizione *</label><input className="input" value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} placeholder="Es. Erogazione SAL n. 2 Misura 19.4" /></div>
            <div>
              <label className="label">Categoria</label>
              <select className="input" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                {categorie.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div><label className="label">Controparte</label><input className="input" value={form.controparte} onChange={(e) => setForm({ ...form, controparte: e.target.value })} placeholder="Es. Regione / AGEA / Socio" /></div>
            <div><label className="label">Importo € *</label><input type="number" step="0.01" min="0" className="input text-right" value={form.importo || ""} onChange={(e) => setForm({ ...form, importo: parseFloat(e.target.value) || 0 })} /></div>
            <div><label className="label">Data prevista</label><input type="date" className="input" value={form.data_prevista} onChange={(e) => setForm({ ...form, data_prevista: e.target.value })} /></div>
            <div>
              <label className="label">Stato</label>
              <select className="input" value={form.stato} onChange={(e) => setForm({ ...form, stato: e.target.value as StatoMovimento, data_effettiva: e.target.value === "realizzato" && !form.data_effettiva ? oggiISO() : form.data_effettiva })}>
                <option value="previsto">Previsto</option>
                <option value="realizzato">Realizzato</option>
                <option value="annullato">Annullato</option>
              </select>
            </div>
            {form.stato === "realizzato" && (
              <div><label className="label">Data effettiva *</label><input type="date" className="input" value={form.data_effettiva} onChange={(e) => setForm({ ...form, data_effettiva: e.target.value })} /></div>
            )}
            <div>
              <label className="label">Conto</label>
              <select className="input" value={form.conto_id} onChange={(e) => setForm({ ...form, conto_id: e.target.value })}>
                <option value="">—</option>
                {conti.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div><label className="label">Riferimento</label><input className="input" value={form.riferimento} onChange={(e) => setForm({ ...form, riferimento: e.target.value })} placeholder="Es. Decreto n. … / Reversale" /></div>
          </div>
          <div><label className="label">Note</label><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Annulla</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving && <Loader2 size={16} className="animate-spin" />} Salva</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!daIncassare} onClose={() => setDaIncassare(null)} title={daIncassare?.tipo === "entrata" ? "Registra incasso" : "Registra uscita"} size="sm">
        <form onSubmit={confermaIncasso} className="space-y-3">
          <p className="text-sm text-gray-600">{daIncassare?.descrizione}</p>
          <div><label className="label">Data</label><input type="date" className="input" value={incasso.data} onChange={(e) => setIncasso({ ...incasso, data: e.target.value })} /></div>
          <div>
            <label className="label">Conto *</label>
            <select className="input" value={incasso.conto_id} onChange={(e) => setIncasso({ ...incasso, conto_id: e.target.value })}>
              <option value="">Seleziona…</option>
              {conti.filter((c) => c.attivo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div><label className="label">Importo effettivo €</label><input type="number" step="0.01" min="0" className="input text-right" value={incasso.importo || ""} onChange={(e) => setIncasso({ ...incasso, importo: parseFloat(e.target.value) || 0 })} /></div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" className="btn-secondary" onClick={() => setDaIncassare(null)}>Annulla</button>
            <button type="submit" className="btn-primary">Conferma</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog open={!!daEliminare} danger title="Eliminare il movimento?" message={daEliminare?.descrizione ?? ""}
        confirmLabel="Elimina" onConfirm={elimina} onCancel={() => setDaEliminare(null)} />
    </div>
  );
}
