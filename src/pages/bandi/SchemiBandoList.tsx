// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import clsx from "clsx";
import { Plus, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, logAudit, messaggioErrore } from "../../lib/utils";
import { STATO_SCHEMA_COLORS, STATO_SCHEMA_LABELS } from "../../constants";
import Table, { Column } from "../../components/ui/Table";
import Modal from "../../components/ui/Modal";
import { BarraProgresso } from "../agenda/AgendaPage";
import type { FaseSchemaBando, SchemaBando, StatoSchemaBando } from "../../types";

type SchemaRow = SchemaBando & {
  gal_schemi_bando_fasi: Pick<FaseSchemaBando, "numero" | "titolo" | "stato">[];
  gal_bandi: { numero: string | null; titolo: string } | null;
};

const FORM_INIT = {
  titolo: "", intervento: "SRG06", sottointervento: "A", azione: "",
  descrizione: "", dotazione_finanziaria: 0, de_minimis: false,
};

/** Passaggi applicabili completati e primo passaggio ancora da chiudere */
export function avanzamentoSchema(fasi: Pick<FaseSchemaBando, "numero" | "titolo" | "stato">[]) {
  const applicabili = fasi.filter((f) => f.stato !== "non_applicabile").sort((a, b) => a.numero - b.numero);
  const fatte = applicabili.filter((f) => f.stato === "completata").length;
  const prossima = applicabili.find((f) => f.stato !== "completata") ?? null;
  const perc = applicabili.length ? Math.round((fatte / applicabili.length) * 100) : 0;
  return { fatte, totale: applicabili.length, prossima, perc };
}

export function codiceSchema(s: Pick<SchemaBando, "intervento" | "sottointervento" | "azione">): string {
  return [s.intervento, s.sottointervento && `Sottointervento ${s.sottointervento}`, s.azione && `Azione ${s.azione}`]
    .filter(Boolean).join(" – ");
}

export default function SchemiBandoList() {
  const [schemi, setSchemi] = useState<SchemaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<StatoSchemaBando | "">("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("gal_schemi_bando")
      .select("*, gal_schemi_bando_fasi(numero, titolo, stato), gal_bandi(numero, titolo)")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(messaggioErrore(error, "Impossibile caricare gli schemi di bando")); return; }
    setSchemi((data ?? []) as SchemaRow[]);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("gal_crea_schema_bando", {
      p_titolo: form.titolo.trim(),
      p_intervento: form.intervento,
      p_sottointervento: form.sottointervento,
      p_azione: form.azione,
      p_descrizione: form.descrizione,
      p_dotazione: form.dotazione_finanziaria,
      p_de_minimis: form.de_minimis,
    });
    setSaving(false);
    if (error || !data) { toast.error(messaggioErrore(error, "Impossibile creare lo schema di bando")); return; }
    const id = String(data);
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "schema_bando", entitaId: id, descrizione: `Creato schema di bando: ${form.titolo.trim()}` });
    toast.success("Schema di bando creato con i 9 passaggi dell'iter");
    setShowModal(false);
    setForm(FORM_INIT);
    navigate(`/schemi-bando/${id}`);
  }

  const visibili = filtro ? schemi.filter((s) => s.stato === filtro) : schemi;

  const columns: Column<SchemaRow>[] = [
    {
      key: "titolo", label: "Schema di bando",
      render: (r) => (
        <div>
          <Link to={`/schemi-bando/${r.id}`} className="font-medium text-primary-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.titolo}
          </Link>
          <div className="text-xs text-gray-500">{codiceSchema(r)}{r.de_minimis ? " · de minimis" : ""}</div>
        </div>
      ),
    },
    {
      key: "avanzamento", label: "Avanzamento", width: "w-56",
      render: (r) => {
        const a = avanzamentoSchema(r.gal_schemi_bando_fasi ?? []);
        return (
          <div className="space-y-1">
            <BarraProgresso perc={a.perc} />
            <div className="text-xs text-gray-600">{a.fatte}/{a.totale} passaggi</div>
          </div>
        );
      },
    },
    {
      key: "prossima", label: "Prossimo passaggio",
      render: (r) => {
        const a = avanzamentoSchema(r.gal_schemi_bando_fasi ?? []);
        return a.prossima
          ? <span className="text-sm">{a.prossima.numero}. {a.prossima.titolo}</span>
          : <span className="text-sm text-green-700">Iter concluso</span>;
      },
    },
    { key: "stato", label: "Stato", render: (r) => <span className={clsx("badge", STATO_SCHEMA_COLORS[r.stato])}>{STATO_SCHEMA_LABELS[r.stato]}</span> },
    { key: "dotazione_finanziaria", label: "Dotazione", render: (r) => formatCurrency(r.dotazione_finanziaria) },
    {
      key: "bando", label: "Bando definitivo",
      render: (r) => r.gal_bandi
        ? <Link to={`/bandi/${r.bando_id}`} className="text-sm text-primary-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.gal_bandi.numero ? `n. ${r.gal_bandi.numero}` : r.gal_bandi.titolo}</Link>
        : <span className="text-sm text-gray-500">Non ancora</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Schemi di bando</h1>
          <p className="text-sm text-gray-600 max-w-3xl">
            Iter di predisposizione, approvazione e pubblicazione concordato con la Regione Lazio (9 passaggi).
            Il bando definitivo approvato dal CdA si gestisce poi in «Bandi attivi».
          </p>
        </div>
        {write && (
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} aria-hidden="true" /> Nuovo schema di bando
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="filtro-stato-schema" className="text-sm text-gray-700">Stato</label>
        <select id="filtro-stato-schema" className="input w-48" value={filtro} onChange={(e) => setFiltro(e.target.value as StatoSchemaBando | "")}>
          <option value="">Tutti</option>
          {(Object.keys(STATO_SCHEMA_LABELS) as StatoSchemaBando[]).map((s) => <option key={s} value={s}>{STATO_SCHEMA_LABELS[s]}</option>)}
        </select>
        <span className="text-sm text-gray-600" aria-live="polite">{visibili.length} schemi</span>
      </div>

      <div className="card">
        <Table data={visibili} columns={columns} keyField="id" isLoading={loading}
          emptyMessage="Nessuno schema di bando. Crea il primo per tracciare l'iter con la Regione."
          onRowClick={(r) => navigate(`/schemi-bando/${r.id}`)} />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuovo schema di bando" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="sb-titolo" className="label">Titolo del bando *</label>
            <input id="sb-titolo" className="input" required value={form.titolo}
              onChange={(e) => setForm({ ...form, titolo: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="sb-intervento" className="label">Intervento *</label>
              <input id="sb-intervento" className="input" required value={form.intervento}
                onChange={(e) => setForm({ ...form, intervento: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <label htmlFor="sb-sotto" className="label">Sottointervento</label>
              <input id="sb-sotto" className="input" value={form.sottointervento}
                onChange={(e) => setForm({ ...form, sottointervento: e.target.value })} />
            </div>
            <div>
              <label htmlFor="sb-azione" className="label">Azione</label>
              <input id="sb-azione" className="input" value={form.azione} placeholder="es. A1"
                onChange={(e) => setForm({ ...form, azione: e.target.value })} />
            </div>
          </div>
          <div>
            <label htmlFor="sb-descrizione" className="label">Descrizione</label>
            <textarea id="sb-descrizione" className="input" rows={3} value={form.descrizione}
              onChange={(e) => setForm({ ...form, descrizione: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label htmlFor="sb-dotazione" className="label">Dotazione finanziaria (€)</label>
              <input id="sb-dotazione" className="input" type="number" step="0.01" min="0" value={form.dotazione_finanziaria}
                onChange={(e) => setForm({ ...form, dotazione_finanziaria: parseFloat(e.target.value) || 0 })} />
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-800 pb-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.de_minimis}
                onChange={(e) => setForm({ ...form, de_minimis: e.target.checked })} />
              <span>Contributi in regime <strong>de minimis</strong> (attiva il passaggio 9: inserimento in RNA)</span>
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="btn-primary flex-1 justify-center" disabled={saving || !form.titolo.trim()}>
              {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />} {saving ? "Salvataggio…" : "Crea schema"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Annulla</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
