// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { create } from "zustand";
import { supabase } from "../lib/supabase";
import type { Profilo, UserRole, Funzione } from "../types";

export type { UserRole };

export interface User {
  id: string;
  email: string;
  nome_completo: string;
  ruolo: UserRole;
  funzione: Funzione | null;
  attivo: boolean;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Amministratore",
  operatore: "Operatore",
  lettore: "Lettore",
};

interface AuthState {
  user: User | null;
  /** true finché non si è verificata la sessione salvata nel browser */
  inizializzazione: boolean;
  isLoading: boolean;
  error: string | null;
  inizializza: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshUser: () => Promise<void>;
}

/** Legge il profilo dal database: senza profilo attivo l'accesso è negato */
async function caricaProfilo(id: string, email: string): Promise<User> {
  const { data, error } = await supabase.from("gal_profili").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Impossibile leggere il profilo utente. Riprova tra qualche istante.");
  const p = data as Profilo | null;
  if (!p) throw new Error("Questo account non è abilitato alla piattaforma del GAL.");
  if (!p.attivo) throw new Error("Account non ancora attivato o disabilitato. Contatta l'amministratore del GAL.");
  return {
    id,
    email: p.email ?? email,
    nome_completo: p.nome_completo || email,
    ruolo: p.ruolo,
    funzione: (p.funzione ?? null) as Funzione | null,
    attivo: p.attivo,
  };
}

function messaggioAccesso(msg: string): string {
  // Il testo originale resta nella console del browser (F12) per chi installa il GAL
  console.warn("Accesso Supabase:", msg);
  if (/invalid login credentials/i.test(msg)) return "E-mail o password non corretti.";
  if (/email not confirmed/i.test(msg)) return "E-mail non ancora confermata: apri il link ricevuto per e-mail.";
  if (/rate limit|too many/i.test(msg)) return "Troppi tentativi. Attendi qualche minuto e riprova.";
  if (/fetch|network/i.test(msg)) return "Server non raggiungibile. Controlla la connessione.";
  if (/api key|apikey|jwt|unauthorized/i.test(msg))
    return "Sito non collegato correttamente al database del GAL: verificare le variabili VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY su Cloudflare.";
  if (/database error|schema/i.test(msg))
    return "Account non valido nel database: ricrearlo da Supabase con Invite user o Add user.";
  return "Accesso non riuscito. Riprova.";
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  inizializzazione: true,
  isLoading: false,
  error: null,

  // La sessione vive nel client Supabase: all'avvio si verifica che sia ancora valida
  // e che il profilo sia attivo (niente dati utente "fidati" salvati nel browser).
  inizializza: async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (s?.user) {
        try {
          set({ user: await caricaProfilo(s.user.id, s.user.email ?? "") });
        } catch {
          await supabase.auth.signOut();
          set({ user: null });
        }
      }
    } finally {
      set({ inizializzazione: false });
    }
    supabase.auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_OUT") set({ user: null });
    });
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(messaggioAccesso(error.message));
      if (!data.user) throw new Error("Utente non trovato");
      try {
        const user = await caricaProfilo(data.user.id, data.user.email ?? "");
        set({ user, isLoading: false });
      } catch (e) {
        await supabase.auth.signOut();
        throw e;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore di accesso";
      set({ error: msg, isLoading: false });
      throw e;
    }
  },

  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null });
  },

  clearError: () => set({ error: null }),

  refreshUser: async () => {
    const { user } = get();
    if (!user) return;
    try {
      set({ user: await caricaProfilo(user.id, user.email) });
    } catch {
      await supabase.auth.signOut();
      set({ user: null });
    }
  },
}));

/** Verifica se l'utente ha permesso di scrivere (admin o operatore) */
export function canWrite(user: User | null): boolean {
  return user?.ruolo === "admin" || user?.ruolo === "operatore";
}

/** Verifica se l'utente è admin */
export function isAdmin(user: User | null): boolean {
  return user?.ruolo === "admin";
}

export type { Profilo };
