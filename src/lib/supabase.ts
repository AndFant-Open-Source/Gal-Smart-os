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
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

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
