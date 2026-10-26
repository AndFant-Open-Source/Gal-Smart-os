// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useGalStore } from "../stores/gal";

import { Search, RefreshCw } from "lucide-react";
import type { AuditEvent } from "../types";

export default function AuditLog() {
  const currentGal = useGalStore((s) => s.currentGal);

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [azioneFilter, setAzioneFilter] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  async function load() {
    setLoading(true);
    let q = supabase
      .from("gal_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (azioneFilter) q = q.eq("azione", azioneFilter);

    const { data } = await q;
    setEvents((data ?? []) as AuditEvent[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [currentGal?.id, page, azioneFilter]);

  const filtered = search
    ? events.filter((e) =>
        [e.username ?? "", e.entita ?? "", e.descrizione ?? "", e.azione]
          .some((v) => v.toLowerCase().includes(search.toLowerCase()))
      )
    : events;

  const AZIONE_COLORS: Record<string, string> = {
    CREATE: "bg-green-100 text-green-700",
    UPDATE: "bg-blue-100 text-blue-700",
    DELETE: "bg-red-100 text-red-600",
    LOGIN: "bg-purple-100 text-purple-700",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Log Attività</h1>
          <p className="text-sm text-gray-500">Traccia delle operazioni eseguite</p>
        </div>
        <button className="btn-secondary" onClick={() => { setPage(0); load(); }}><RefreshCw size={16} /></button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Cerca utente, entità, descrizione..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-40" value={azioneFilter} onChange={(e) => { setAzioneFilter(e.target.value); setPage(0); }}>
          <option value="">Tutte le azioni</option>
          <option value="CREATE">Crea</option>
          <option value="UPDATE">Modifica</option>
          <option value="DELETE">Elimina</option>
          <option value="LOGIN">Login</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-gray-400">Caricamento...</p>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-center text-gray-400">Nessun evento trovato</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="px-3 py-2 text-left">Data/Ora</th>
                  <th className="px-3 py-2 text-left">Utente</th>
                  <th className="px-3 py-2 text-center">Azione</th>
                  <th className="px-3 py-2 text-left">Entità</th>
                  <th className="px-3 py-2 text-left">Descrizione</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString("it-IT")}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-xs">{e.username ?? e.user_id ?? "-"}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`badge text-xs ${AZIONE_COLORS[e.azione] ?? "bg-gray-100 text-gray-600"}`}>{e.azione}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{e.entita ?? "-"}</td>
                    <td className="px-3 py-2 text-xs">{e.descrizione ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center text-sm text-gray-500">
        <span>Pagina {page + 1} · {filtered.length} risultati</span>
        <div className="flex gap-2">
          <button className="btn-secondary text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Precedente</button>
          <button className="btn-secondary text-xs" disabled={events.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}>Successiva →</button>
        </div>
      </div>
    </div>
  );
}
