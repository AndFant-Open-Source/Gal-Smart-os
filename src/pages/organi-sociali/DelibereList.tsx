// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useGalStore } from "../../stores/gal";
import { formatDate } from "../../lib/utils";
import { Search, Download } from "lucide-react";
import Table, { Column } from "../../components/ui/Table";
import * as XLSX from "xlsx";
import type { Delibera } from "../../types";

const ESITO_COLORS: Record<string, string> = {
  approvata: "bg-green-100 text-green-700",
  respinta:  "bg-red-100 text-red-600",
  ritirata:  "bg-gray-100 text-gray-500",
};

type DeliberaRow = Delibera & { gal_sedute?: { data_seduta: string; numero: number | null } | null };

export default function DelibereList() {
  const navigate = useNavigate();
  const currentGal = useGalStore((s) => s.currentGal);

  const [delibere, setDelibere] = useState<DeliberaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function load() {
    if (!currentGal) return;
    setLoading(true);
    const { data } = await supabase.from("gal_delibere").select("*, gal_sedute(data_seduta, numero)").eq("gal_id", currentGal.id).order("anno", { ascending: false });
    setDelibere((data ?? []) as DeliberaRow[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id]);

  const filtered = delibere.filter((d) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [d.numero, d.oggetto, d.anno?.toString() ?? ""].some((v) => String(v).toLowerCase().includes(q));
  });

  function handleExport() {
    const rows = filtered.map((d) => ({
      "N. Delibera": d.numero, "Anno": d.anno, "Oggetto": d.oggetto,
      "Esito": d.esito ?? "", "Data": formatDate(d.data_delibera),
      "Seduta del": d.gal_sedute?.data_seduta ? formatDate(d.gal_sedute.data_seduta) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Delibere");
    XLSX.writeFile(wb, `delibere_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const columns: Column<DeliberaRow>[] = [
    { key: "numero", label: "N. Delibera", width: "w-28" },
    { key: "anno", label: "Anno", width: "w-16" },
    { key: "oggetto", label: "Oggetto" },
    { key: "esito", label: "Esito", render: (r) => r.esito ? <span className={`badge ${ESITO_COLORS[r.esito] ?? "bg-gray-100"}`}>{r.esito}</span> : <span className="text-gray-300">-</span> },
    { key: "data_delibera", label: "Data", render: (r) => formatDate(r.data_delibera) },
    { key: "seduta_id", label: "Seduta del", render: (r) => r.gal_sedute ? formatDate(r.gal_sedute.data_seduta) : "-" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Delibere</h1>
          <p className="text-sm text-gray-500">{filtered.length} delibere</p>
        </div>
        <button className="btn-secondary" onClick={handleExport}><Download size={16} /> Export Excel</button>
      </div>

      <div className="card p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 text-sm" placeholder="Cerca per numero, oggetto, anno..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <Table
          data={filtered}
          columns={columns}
          keyField="id"
          isLoading={loading}
          onRowClick={(r) => r.seduta_id && navigate(`/sedute/${r.seduta_id}`)}
          emptyMessage="Nessuna delibera trovata"
        />
      </div>
    </div>
  );
}
