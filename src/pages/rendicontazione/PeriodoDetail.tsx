// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useNavigate } from "react-router-dom";
import { ArrowLeft, AlertCircle } from "lucide-react";

export default function PeriodoDetail() {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button className="btn-ghost p-1" onClick={() => navigate(-1)}><ArrowLeft size={20} /></button>
        <h1 className="text-xl font-bold">Dettaglio Periodo</h1>
      </div>
      <div className="card p-8 text-center">
        <AlertCircle size={32} className="text-yellow-500 mx-auto mb-3" />
        <p className="text-gray-600">Usa la sezione <strong>Report SES</strong> per gestire i periodi di rendicontazione.</p>
      </div>
    </div>
  );
}
