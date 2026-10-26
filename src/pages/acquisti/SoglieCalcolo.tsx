// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useState } from "react";
import { formatCurrency } from "../../lib/utils";
import { Calculator, CheckCircle2, AlertTriangle, Info } from "lucide-react";

interface SogliaCheck {
  descrizione: string;
  soglia: number;
  procedura: string;
  normativa: string;
  ok: boolean | null;
}

const SOGLIE_2024: Array<Omit<SogliaCheck, "ok">> = [
  {
    descrizione: "Affidamento diretto senza preventivi",
    soglia: 5000,
    procedura: "Affidamento diretto",
    normativa: "Art. 50 c.1 lett.a D.Lgs. 36/2023",
  },
  {
    descrizione: "Affidamento diretto con un'unica consultazione",
    soglia: 140000,
    procedura: "Affidamento diretto",
    normativa: "Art. 50 c.1 lett.b D.Lgs. 36/2023",
  },
  {
    descrizione: "Procedura negoziata (almeno 5 operatori)",
    soglia: 140000,
    procedura: "Procedura negoziata",
    normativa: "Art. 50 c.1 lett.c D.Lgs. 36/2023",
  },
  {
    descrizione: "Procedure sotto soglia europee forniture/servizi",
    soglia: 221000,
    procedura: "Procedura aperta semplificata",
    normativa: "Art. 50 c.1 lett.d D.Lgs. 36/2023 + Dir. 2014/24/UE",
  },
  {
    descrizione: "Soglia europea forniture e servizi PA",
    soglia: 221000,
    procedura: "Procedura aperta",
    normativa: "Regolamento UE n. 2023/2495",
  },
  {
    descrizione: "Soglia europea lavori",
    soglia: 5538000,
    procedura: "Procedura aperta",
    normativa: "Regolamento UE n. 2023/2495",
  },
];

export default function SoglieCalcolo() {
  const [importo, setImporto] = useState<number | "">("");
  const [tipologia, setTipologia] = useState<"forniture_servizi" | "lavori">("forniture_servizi");
  const [checked, setChecked] = useState(false);

  function calcola() {
    setChecked(true);
  }

  // Procedura consigliata
  const importoNum = importo !== "" ? Number(importo) : null;
  function proceduraConsigliata(): string {
    if (importoNum === null) return "";
    if (tipologia === "forniture_servizi") {
      if (importoNum <= 5000) return "Affidamento diretto senza preventivi (Art. 50 c.1 lett.a)";
      if (importoNum <= 140000) return "Affidamento diretto con consultazione (Art. 50 c.1 lett.b)";
      if (importoNum <= 221000) return "Procedura negoziata o aperta semplificata (Art. 50 c.1 lett.c-d)";
      return "Procedura aperta sopra soglia europea";
    } else {
      if (importoNum <= 150000) return "Affidamento diretto (Art. 50 c.1 lett.a-b)";
      if (importoNum <= 1000000) return "Procedura negoziata (Art. 50 c.2 lett.a)";
      if (importoNum <= 5538000) return "Procedura aperta semplificata";
      return "Procedura aperta sopra soglia europea";
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Calcolo Soglie Appalti</h1>
        <p className="text-sm text-gray-500">Verifica la procedura corretta in base all'importo (D.Lgs. 36/2023 — Codice dei Contratti Pubblici)</p>
      </div>

      {/* Input */}
      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2 font-semibold text-gray-700">
          <Calculator size={18} /> Parametri di calcolo
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Importo stimato (€) *</label>
            <input
              className="input text-lg font-mono"
              type="number"
              step="0.01"
              min={0}
              placeholder="es. 45000"
              value={importo}
              onChange={(e) => { setImporto(e.target.value === "" ? "" : parseFloat(e.target.value)); setChecked(false); }}
            />
          </div>
          <div>
            <label className="label">Tipologia</label>
            <select className="input" value={tipologia} onChange={(e) => { setTipologia(e.target.value as "forniture_servizi" | "lavori"); setChecked(false); }}>
              <option value="forniture_servizi">Forniture e Servizi</option>
              <option value="lavori">Lavori</option>
            </select>
          </div>
        </div>
        <button className="btn-primary" onClick={calcola} disabled={importo === ""}>
          <Calculator size={16} /> Calcola procedura
        </button>
      </div>

      {/* Risultato consigliato */}
      {checked && importoNum !== null && (
        <div className="card p-4 border-l-4 border-green-600 bg-green-50">
          <p className="text-xs text-gray-500 mb-1">Procedura consigliata per {formatCurrency(importoNum)}</p>
          <p className="font-bold text-green-800 text-lg">{proceduraConsigliata()}</p>
          <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
            <Info size={12} /> Verifica sempre con il responsabile legale o il RUP prima di procedere
          </div>
        </div>
      )}

      {/* Tabella soglie */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-gray-700 text-sm">
          Soglie di riferimento 2024 — D.Lgs. 36/2023
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-700 text-white">
            <tr>
              <th className="px-4 py-2 text-left">Procedura</th>
              <th className="px-4 py-2 text-right">Soglia massima</th>
              <th className="px-4 py-2 text-left hidden md:table-cell">Normativa</th>
              {checked && <th className="px-4 py-2 text-center">Compatibile</th>}
            </tr>
          </thead>
          <tbody>
            {SOGLIE_2024.map((s, i) => {
              const compatibile = importoNum !== null ? importoNum <= s.soglia : null;
              return (
                <tr key={i} className={`border-b hover:bg-gray-50 ${compatibile === true ? "bg-green-50" : compatibile === false ? "" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.procedura}</div>
                    <div className="text-xs text-gray-500">{s.descrizione}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {formatCurrency(s.soglia)}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 hidden md:table-cell">{s.normativa}</td>
                  {checked && (
                    <td className="px-4 py-3 text-center">
                      {compatibile === true ? (
                        <span className="text-green-600 flex items-center justify-center gap-1">
                          <CheckCircle2 size={16} /> Sì
                        </span>
                      ) : (
                        <span className="text-red-400 flex items-center justify-center gap-1">
                          <AlertTriangle size={16} /> No
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Note */}
      <div className="card p-4 bg-yellow-50 border border-yellow-200">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-yellow-700 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-yellow-800 space-y-1">
            <p><strong>Attenzione:</strong> Le soglie riportate sono aggiornate al 2024 (Reg. UE 2023/2495). Verificare sempre gli aggiornamenti biennali della Commissione Europea.</p>
            <p>Per gli enti del Terzo Settore e i GAL, applicare le indicazioni specifiche delle Autorità di Gestione del PSR/CSR.</p>
            <p>L'importo da considerare è sempre quello <strong>al netto dell'IVA</strong>.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
