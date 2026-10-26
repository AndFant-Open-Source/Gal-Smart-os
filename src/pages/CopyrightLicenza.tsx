// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { Code2, ExternalLink, Scale } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { URL_CODICE_SORGENTE } from "../components/InfoSoftware";
import { useAuthStore } from "../stores/auth";

function Collegamento({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-700 underline hover:no-underline">
      {children}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

function Riquadro({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 space-y-2 text-sm text-gray-700">
      <h2 className="text-base font-semibold text-gray-900">{titolo}</h2>
      {children}
    </section>
  );
}

/**
 * Note legali appropriate (AGPL-3.0, sezione 5 lettera d): titolarità, licenza, termini
 * aggiuntivi, assenza di garanzia e link al codice sorgente (sezione 13).
 * Pagina raggiungibile anche senza accesso.
 */
export default function CopyrightLicenza() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Scale size={28} className="text-primary-700" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Copyright e licenza</h1>
          <p className="text-sm text-gray-500">GAL OS · versione {__VERSIONE_APP__}</p>
        </div>
      </div>

      <Riquadro titolo="Titolarità">
        <p className="font-semibold">GAL OS © 2026 Andrea Fantini — software libero AGPL-3.0</p>
        <p>Titolare dei diritti d'autore: Andrea Fantini.</p>
      </Riquadro>

      <Riquadro titolo="Licenza">
        <p>
          Questo programma è software libero, rilasciato sotto la{" "}
          <Collegamento href="https://www.gnu.org/licenses/agpl-3.0.html">GNU Affero General Public License versione 3 o successive</Collegamento>{" "}
          (AGPL-3.0-or-later). Chiunque, comprese le pubbliche amministrazioni, può usarlo, studiarlo, modificarlo e
          ridistribuirlo gratuitamente. Chi lo modifica e lo rende disponibile via rete deve pubblicare il codice sorgente delle modifiche.
        </p>
        <p>Termini aggiuntivi previsti dalla sezione 7 della licenza:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>l'avviso «GAL OS © 2026 Andrea Fantini — software libero AGPL-3.0» va mantenuto nell'interfaccia (nelle versioni modificate: «Basato su GAL OS …»);</li>
          <li>le versioni modificate devono essere riconoscibili come tali;</li>
          <li>le versioni modificate distribuite a terzi devono avere un nome diverso da "GAL OS".</li>
        </ul>
        <p>La documentazione è rilasciata sotto licenza Creative Commons Attribuzione 4.0 (CC-BY-4.0).</p>
      </Riquadro>

      <Riquadro titolo="Assenza di garanzia">
        <p>
          Il programma è distribuito nella speranza che sia utile, ma senza alcuna garanzia, nemmeno quella implicita di
          commerciabilità o di idoneità a uno scopo particolare, nei limiti consentiti dalla legge (sezioni 15 e 16 della licenza).
        </p>
      </Riquadro>

      <Riquadro titolo="Codice sorgente">
        <p className="flex items-center gap-2">
          <Code2 size={16} className="text-gray-500" aria-hidden="true" />
          <Collegamento href={URL_CODICE_SORGENTE}>{URL_CODICE_SORGENTE}</Collegamento>
        </p>
      </Riquadro>

      <button className="btn-secondary" onClick={() => navigate(user ? "/" : "/login")}>
        {user ? "Torna all'applicazione" : "Torna all'accesso"}
      </button>
    </main>
  );
}
