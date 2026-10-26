// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { createClient } from "@supabase/supabase-js";

/**
 * Client Supabase dell'installazione.
 * Edizione per singolo GAL: ogni GAL ha il proprio progetto Supabase, indicato
 * nelle variabili d'ambiente (file .env in sviluppo, Cloudflare Pages in produzione).
 * Nel browser si usa SOLO la chiave pubblica "anon": la sicurezza dei dati è
 * garantita dalle regole Row Level Security del database (supabase/schema.sql).
 */
// Spazi e "/" finali copiati per errore nelle variabili di Cloudflare rendono il server
// irraggiungibile: si tolgono qui.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\s+/g, "").replace(/\/+$/, "");
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.replace(/\s+/g, "");

export const configurazioneMancante = !supabaseUrl || !supabaseAnonKey;

export const supabase = createClient(
  supabaseUrl || "https://configurazione-mancante.invalid",
  supabaseAnonKey || "configurazione-mancante",
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: "galos-auth",
      flowType: "pkce",
    },
    global: {
      headers: { "x-application-name": "gal-os" },
    },
  }
);
