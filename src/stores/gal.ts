// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Dati del GAL servito da questa installazione.
 * Edizione per singolo GAL: il database contiene una sola riga in gal_gal
 * (vincolo nel database), caricata dopo l'accesso. Non esiste alcun cambio di GAL.
 */
import { create } from "zustand";
import { supabase } from "../lib/supabase";
import type { Gal } from "../types";

interface GalState {
  currentGal: Gal | null;
  carica: () => Promise<void>;
  setCurrentGal: (gal: Gal) => void;
  reset: () => void;
}

export const useGalStore = create<GalState>()((set) => ({
  currentGal: null,
  carica: async () => {
    const { data, error } = await supabase.from("gal_gal").select("*").limit(1).maybeSingle();
    if (error) {
      console.error(error);
      return;
    }
    set({ currentGal: (data as Gal | null) ?? null });
  },
  setCurrentGal: (gal) => set({ currentGal: gal }),
  reset: () => set({ currentGal: null }),
}));

/** Restituisce il gal_id da usare nelle query */
export function useCurrentGalId(): string | null {
  return useGalStore((s) => s.currentGal?.id ?? null);
}

/** Nome del GAL mostrato prima dell'accesso (variabile d'ambiente) */
export const NOME_ENTE: string = import.meta.env.VITE_NOME_ENTE || "GAL";
