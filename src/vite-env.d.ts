// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
/// <reference types="vite/client" />

/** Versione dell'applicazione, da package.json (vite.config.ts) */
declare const __VERSIONE_APP__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_NOME_ENTE?: string;
  readonly VITE_URL_CODICE_SORGENTE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
