// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import clsx from "clsx";
import { Plus, Settings, FileDown, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, messaggioErrore } from "../../lib/utils";
import Table, { Column } from "../../components/ui/Table";
import {
  STATO_MANDATO_COLORS, STATO_MANDATO_LABELS, caricaEnte, caricaImpostazioni, generaWord, nomeFileMandato, numeroStampa, scaricaFile,
} from "../../lib/mandati/servizio";
import type { Mandato, StatoMandato } from "../../types";

export default function MandatiList() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const gal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [mandati, setMandati] = useState<Mandato[]>([]);
  const [loading, setLoading] = useState(true);
  const [anno, setAnno] = useState<number | "">(new Date().getFullYear());
  const [stato, setStato] = useState<StatoMandato | "">("");
  const [cerca, setCerca] = useState("");
  const [inDownload, setInDownload] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    let q = supabase.from("gal_mandati").select("*").order("anno", { ascending: false }).order("numero", { ascending: false });
    if (anno) q = q.eq("anno", anno);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(messaggioErrore(error, "Impossibile caricare i mandati")); return; }
    setMandati((data ?? []) as Mandato[]);
  }

  useEffect(() => { load(); }, [anno]);

  const visibili = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    return mandati.filter((m) => (!stato || m.stato === stato)
      && (!t || [m.beneficiario_nome, m.numero_documento, m.scheda?.causale, numeroStampa(m)].some((x) => x?.toLowerCase().includes(t))));
  }, [mandati, stato, cerca]);

  const totale = visibili.filter((m) => m.stato !== "annullato").reduce((s, m) => s + Number(m.netto), 0);

  async function scarica(m: Mandato) {
    if (!gal) return;
    setInDownload(m.id);
    try {
      const ente = await caricaEnte(gal, await caricaImpostazioni());
      scaricaFile(await generaWord(m, ente), nomeFileMandato(m));
    } catch (e) {
      toast.error(messaggioErrore(e, "Impossibile generare il Word"));
    } finally {
      setInDownload(null);
    }
  }

  const columns: Column<Mandato>[] = [
    {
      key: "numero", label: "N.", width: "w-24",
      render: (m) => <Link to={`/mandati/${m.id}`} className="font-semibold text-primary-700 hover:underline" onClick={(e) => e.stopPropagation()}>{numeroStampa(m)}</Link>,
    },
    { key: "data_ordine", label: "Data", render: (m) => formatDate(m.data_ordine) },
    {
      key: "beneficiario_nome", label: "Beneficiario",
      render: (m) => (
        <div>
          <div className="font-medium">{m.beneficiario_nome}</div>
          {m.numero_documento && <div className="text-xs text-gray-600">Doc. n. {m.numero_documento}</div>}
        </div>
      ),
    },
    { key: "modalita", label: "Modalità", render: (m) => (m.modalita === "f24" ? "F24" : "Bonifico") },
    { key: "netto", label: "Importo", className: "text-right", render: (m) => <span className={clsx("font-semibold", m.stato === "annullato" && "line-through text-gray-500")}>{formatCurrency(m.netto)}</span> },
    { key: "stato", label: "Stato", render: (m) => <span className={clsx("badge", STATO_MANDATO_COLORS[m.stato])}>{STATO_MANDATO_LABELS[m.stato]}</span> },
    {
      key: "word", label: "Word",
      render: (m) => (
        <button className="btn-ghost p-1.5" onClick={(e) => { e.stopPropagation(); scarica(m); }} disabled={inDownload === m.id}
          aria-label={`Scarica Word del mandato ${numeroStampa(m)}`} title="Scarica Word">
          {inDownload === m.id ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileDown size={16} aria-hidden="true" />}
        </button>
      ),
    },
  ];

  const anni = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Mandati di pagamento</h1>
          <p className="text-sm text-gray-600">Ordini di pagamento del GAL. Il mandato si scarica in Word; per il PDF usa «Salva con nome → PDF» in Word.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link to="/mandati/impostazioni" className="btn-secondary"><Settings size={16} aria-hidden="true" /> Impostazioni</Link>
          {write && <button className="btn-primary" onClick={() => navigate("/mandati/nuovo")}><Plus size={16} aria-hidden="true" /> Nuovo mandato</button>}
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label htmlFor="flt-anno" className="label">Anno</label>
          <select id="flt-anno" className="input w-32" value={anno} onChange={(e) => setAnno(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Tutti</option>
            {anni.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="flt-stato" className="label">Stato</label>
          <select id="flt-stato" className="input w-40" value={stato} onChange={(e) => setStato(e.target.value as StatoMandato | "")}>
            <option value="">Tutti</option>
            {(Object.keys(STATO_MANDATO_LABELS) as StatoMandato[]).map((s) => <option key={s} value={s}>{STATO_MANDATO_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="flt-cerca" className="label">Cerca</label>
          <input id="flt-cerca" className="input" placeholder="Beneficiario, numero, causale…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
        </div>
        <p className="text-sm text-gray-700 pb-2" aria-live="polite">{visibili.length} mandati · totale {formatCurrency(totale)}</p>
      </div>

      <div className="card">
        <Table data={visibili} columns={columns} keyField="id" isLoading={loading}
          emptyMessage="Nessun mandato. Crealo da una riga dello Scadenzario pagamenti, da un giustificativo o con «Nuovo mandato»."
          onRowClick={(m) => navigate(`/mandati/${m.id}`)} />
      </div>
    </div>
  );
}
