// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

// Versione mostrata a piè di pagina, così l'utente sa quale versione del codice è in esecuzione
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __VERSIONE_APP__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Librerie grandi in file separati: il browser le scarica una volta e le tiene in cache
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          grafici: ["recharts"],
          pdf: ["jspdf", "jspdf-autotable"],
          excel: ["xlsx", "jszip"],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
  },
});
