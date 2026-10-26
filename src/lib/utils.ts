// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { supabase } from "./supabase";

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "€ 0,00";
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value));
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("it-IT");
}

export function formatDateShort(date: string | null | undefined): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "-";
  return Number(value).toLocaleString("it-IT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function truncate(text: string | null | undefined, max = 60): string {
  if (!text) return "-";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/**
 * Registra un evento nel registro attività (tabella gal_audit).
 * Il GAL e l'utente vengono impostati dal database (valori predefiniti e regole RLS):
 * il parametro galId resta per compatibilità con le pagine esistenti.
 * Un errore di registrazione non blocca mai l'operazione principale.
 */
export async function logAudit(params: {
  galId?: string | null;
  userId: string | null;
  username: string | null;
  azione: string;
  entita?: string;
  entitaId?: string;
  descrizione?: string;
}) {
  const { error } = await supabase.from("gal_audit").insert({
    user_id: params.userId,
    username: params.username,
    azione: params.azione,
    entita: params.entita ?? null,
    entita_id: params.entitaId ?? null,
    descrizione: params.descrizione ?? null,
  });
  if (error) console.error("Registro attività non aggiornato", error);
}

/**
 * Traduce un errore del database o della rete in un messaggio comprensibile.
 * Il dettaglio tecnico resta nella console del browser, non viene mostrato all'utente.
 */
export function messaggioErrore(e: unknown, contesto = "Operazione non riuscita"): string {
  if (e) console.error(e);
  const err = (typeof e === "object" && e !== null ? e : {}) as { code?: string; message?: string; status?: number };
  const code = err.code ?? "";
  const msg = String(err.message ?? "");
  if (code === "42501" || /row-level security|permission denied|not authorized/i.test(msg)) {
    return "Non hai i permessi per questa operazione.";
  }
  if (code === "23505") return "Esiste già un record con questi dati (ad esempio lo stesso numero).";
  if (code === "23503") return "Operazione non possibile: il record è collegato ad altri dati.";
  if (code === "23502") return "Manca un campo obbligatorio.";
  if (code === "23514") return "Alcuni dati non rispettano le regole previste (controlla i campi obbligatori).";
  if (code === "22P02" || code === "22007" || code === "22008") return "Formato di un dato non valido (controlla date e numeri).";
  if (code === "P0001" && msg) return msg; // messaggi scritti apposta nelle funzioni del database
  if (code === "PGRST301" || err.status === 401 || /jwt|token/i.test(msg)) return "Sessione scaduta: accedi di nuovo.";
  if (/fetch|network|failed to fetch/i.test(msg)) return "Server non raggiungibile. Controlla la connessione e riprova.";
  if (/payload too large|exceeded the maximum allowed size|413/i.test(msg)) return "File troppo grande (massimo 50 MB).";
  return `${contesto}. Riprova; se il problema continua contatta l'assistenza.`;
}

/** @deprecated usare messaggioErrore */
export function errorMsg(e: unknown): string {
  return messaggioErrore(e);
}
