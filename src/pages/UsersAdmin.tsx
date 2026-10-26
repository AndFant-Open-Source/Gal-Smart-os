// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";
import { RefreshCw, UserCheck, UserX, Info, Loader2, KeyRound } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuthStore, ROLE_LABELS } from "../stores/auth";
import { logAudit, messaggioErrore } from "../lib/utils";
import { FUNZIONI, FUNZIONE_LABELS } from "../constants";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import type { Profilo, UserRole, Funzione } from "../types";

const RUOLI: UserRole[] = ["admin", "operatore", "lettore"];

/**
 * Persone del GAL. Edizione per singolo GAL:
 * - gli account si creano SOLO dalla dashboard Supabase (Authentication → Invite user),
 *   così la registrazione libera resta disattivata;
 * - ogni nuovo account riceve un profilo disattivato: qui l'amministratore lo attiva
 *   e assegna ruolo e funzione. Il database impedisce di togliere l'ultimo amministratore.
 */
export default function UsersAdmin() {
  const user = useAuthStore((s) => s.user);
  const [profili, setProfili] = useState<Profilo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggleConfirm, setToggleConfirm] = useState<Profilo | null>(null);
  const [resetPer, setResetPer] = useState<Profilo | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("gal_profili").select("*").order("nome_completo");
    if (error) toast.error(messaggioErrore(error, "Impossibile caricare gli utenti"));
    setProfili((data ?? []) as Profilo[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function aggiorna(p: Profilo, patch: Partial<Profilo>, descrizione: string, successo: string) {
    const { error } = await supabase.from("gal_profili").update(patch).eq("id", p.id);
    if (error) { toast.error(messaggioErrore(error)); return; }
    if (user) await logAudit({ userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "utente", entitaId: p.id, descrizione });
    toast.success(successo);
    load();
  }

  async function inviaReset(p: Profilo) {
    setResetPer(null);
    if (!p.email) { toast.error("Per questo utente non è indicata un'e-mail"); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(p.email, { redirectTo: `${window.location.origin}/nuova-password` });
    if (error) { toast.error(messaggioErrore(error, "Invio dell'e-mail non riuscito")); return; }
    toast.success(`E-mail per reimpostare la password inviata a ${p.email}`);
  }

  const daAttivare = profili.filter((p) => !p.attivo).length;

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Utenti del GAL</h1>
          <p className="text-sm text-gray-500">{profili.length} account{daAttivare ? ` · ${daAttivare} da attivare` : ""}</p>
        </div>
        <button className="btn-secondary" onClick={load} title="Aggiorna"><RefreshCw size={16} /> Aggiorna</button>
      </div>

      <div className="card p-4 text-sm text-gray-700 flex gap-3 bg-blue-50 border-blue-100">
        <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p><strong>Come aggiungere una persona:</strong> in Supabase apri <em>Authentication → Users → Invite user</em> e inserisci la sua e-mail.</p>
          <p>L'account compare qui come <em>disattivato</em>: attivalo e scegli il ruolo. Se il GAL lavora con un solo utente, basta l'amministratore.</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        {loading ? (
          <div className="p-10 flex justify-center text-gray-400 gap-2"><Loader2 className="animate-spin" size={18} /> Caricamento…</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="table-header text-left">Nome</th>
                <th className="table-header text-left">Ruolo</th>
                <th className="table-header text-left">Funzione (Agenda)</th>
                <th className="table-header text-left">Stato</th>
                <th className="table-header"><span className="sr-only">Azioni</span></th>
              </tr>
            </thead>
            <tbody>
              {profili.map((p) => {
                const io = p.id === user?.id;
                return (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="table-cell">
                      <div className="font-medium">{p.nome_completo || p.email}{io && <span className="text-xs text-gray-400"> (tu)</span>}</div>
                      <div className="text-xs text-gray-400">{p.email ?? "—"}</div>
                    </td>
                    <td className="table-cell">
                      <label className="sr-only" htmlFor={`ruolo-${p.id}`}>Ruolo di {p.nome_completo}</label>
                      <select id={`ruolo-${p.id}`} className="input py-1 text-xs w-36" value={p.ruolo} disabled={io}
                        onChange={(e) => aggiorna(p, { ruolo: e.target.value as UserRole }, `Ruolo ${p.email}: ${e.target.value}`, "Ruolo aggiornato")}>
                        {RUOLI.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                    <td className="table-cell">
                      <label className="sr-only" htmlFor={`funzione-${p.id}`}>Funzione di {p.nome_completo}</label>
                      <select id={`funzione-${p.id}`} className="input py-1 text-xs w-40" value={p.funzione ?? ""}
                        onChange={(e) => aggiorna(p, { funzione: (e.target.value || null) as Funzione | null }, `Funzione ${p.email}`, "Funzione aggiornata")}>
                        <option value="">—</option>
                        {FUNZIONI.map((f) => <option key={f} value={f}>{FUNZIONE_LABELS[f]}</option>)}
                      </select>
                    </td>
                    <td className="table-cell">
                      <span className={clsx("badge", p.attivo ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                        {p.attivo ? "Attivo" : "Da attivare / disattivato"}
                      </span>
                    </td>
                    <td className="table-cell text-right whitespace-nowrap">
                      <button className="btn-ghost p-1.5 text-blue-600" title="Invia e-mail per reimpostare la password"
                        aria-label={`Reimposta la password di ${p.nome_completo || p.email}`} onClick={() => setResetPer(p)}>
                        <KeyRound size={15} />
                      </button>
                      <button className={clsx("btn-ghost p-1.5", p.attivo ? "text-red-500" : "text-green-600")} disabled={io}
                        title={p.attivo ? "Disattiva" : "Attiva"} aria-label={p.attivo ? "Disattiva utente" : "Attiva utente"}
                        onClick={() => setToggleConfirm(p)}>
                        {p.attivo ? <UserX size={15} /> : <UserCheck size={15} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!toggleConfirm}
        danger={!!toggleConfirm?.attivo}
        title={toggleConfirm?.attivo ? "Disattivare l'utente?" : "Attivare l'utente?"}
        message={toggleConfirm?.attivo
          ? `${toggleConfirm?.nome_completo || toggleConfirm?.email} non potrà più accedere ai dati del GAL.`
          : `${toggleConfirm?.nome_completo || toggleConfirm?.email} potrà accedere con il ruolo ${toggleConfirm ? ROLE_LABELS[toggleConfirm.ruolo] : ""}.`}
        confirmLabel={toggleConfirm?.attivo ? "Disattiva" : "Attiva"}
        onConfirm={() => {
          const p = toggleConfirm;
          setToggleConfirm(null);
          if (p) aggiorna(p, { attivo: !p.attivo }, `${p.attivo ? "Disattivato" : "Attivato"} ${p.email}`, p.attivo ? "Utente disattivato" : "Utente attivato");
        }}
        onCancel={() => setToggleConfirm(null)}
      />
      <ConfirmDialog
        open={!!resetPer}
        title="Reimpostare la password?"
        message={`Verrà inviata a ${resetPer?.email ?? ""} un'e-mail con il link per scegliere una nuova password.`}
        confirmLabel="Invia e-mail"
        onConfirm={() => { if (resetPer) inviaReset(resetPer); }}
        onCancel={() => setResetPer(null)}
      />
    </div>
  );
}
