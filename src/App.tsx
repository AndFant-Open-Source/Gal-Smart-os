// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "./stores/auth";
import { configurazioneMancante } from "./lib/supabase";
import LoginPage from "./pages/LoginPage";
import MainLayout from "./components/layout/MainLayout";

// Le pagine vengono caricate solo quando servono: il primo accesso è più veloce
const Dashboard = lazy(() => import("./pages/dashboard/Dashboard"));
const NuovaPassword = lazy(() => import("./pages/NuovaPassword"));
const CopyrightLicenza = lazy(() => import("./pages/CopyrightLicenza"));

// Bandi
const BandiList = lazy(() => import("./pages/bandi/BandiList"));
const BandoDetail = lazy(() => import("./pages/bandi/BandoDetail"));
const DomandeList = lazy(() => import("./pages/bandi/DomandeList"));
const DomandaDetail = lazy(() => import("./pages/bandi/DomandaDetail"));

// Organi sociali
const SociList = lazy(() => import("./pages/organi-sociali/SociList"));
const SedutaList = lazy(() => import("./pages/organi-sociali/SedutaList"));
const SedutaDetail = lazy(() => import("./pages/organi-sociali/SedutaDetail"));
const DelibereList = lazy(() => import("./pages/organi-sociali/DelibereList"));
const QuoteList = lazy(() => import("./pages/organi-sociali/QuoteList"));
const ComponentiList = lazy(() => import("./pages/organi-sociali/ComponentiList"));

// Rendicontazione
const GiustificativiList = lazy(() => import("./pages/rendicontazione/GiustificativiList"));
const GiustificativoDetail = lazy(() => import("./pages/rendicontazione/GiustificativoDetail"));
const ReportSes = lazy(() => import("./pages/rendicontazione/ReportSes"));
const FornitoriList = lazy(() => import("./pages/rendicontazione/FornitoriList"));
const PrevisioneList = lazy(() => import("./pages/rendicontazione/PrevisioneList"));
const QuadroRendicontazione = lazy(() => import("./pages/rendicontazione/QuadroRendicontazione"));

// Report
const ReportPage = lazy(() => import("./pages/report/ReportPage"));

// Acquisti
const ProcedureList = lazy(() => import("./pages/acquisti/ProcedureList"));
const ProceduraDetail = lazy(() => import("./pages/acquisti/ProceduraDetail"));
const SoglieCalcolo = lazy(() => import("./pages/acquisti/SoglieCalcolo"));
const ContrattiList = lazy(() => import("./pages/acquisti/ContrattiList"));
const ContrattoDetail = lazy(() => import("./pages/acquisti/ContrattoDetail"));

// Archivio
const RegistroCatalogazione = lazy(() => import("./pages/archivio/RegistroCatalogazione"));

// Agenda, scadenzario, cash flow, esportazione
const AgendaPage = lazy(() => import("./pages/agenda/AgendaPage"));
const PraticaDetail = lazy(() => import("./pages/agenda/PraticaDetail"));
const ScadenzarioPage = lazy(() => import("./pages/scadenzario/ScadenzarioPage"));
const ScadenzaDetail = lazy(() => import("./pages/scadenzario/ScadenzaDetail"));
const CashFlowPage = lazy(() => import("./pages/cashflow/CashFlowPage"));
const EsportaExcel = lazy(() => import("./pages/EsportaExcel"));

// Amministrazione
const UsersAdmin = lazy(() => import("./pages/UsersAdmin"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Impostazioni = lazy(() => import("./pages/Impostazioni"));
const BackupRestore = lazy(() => import("./pages/BackupRestore"));

function Caricamento() {
  return (
    <div className="flex items-center justify-center gap-2 text-gray-400 py-20" role="status">
      <Loader2 className="animate-spin" size={18} aria-hidden="true" /> Caricamento…
    </div>
  );
}

function ConfigurazioneMancante() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-6 max-w-lg space-y-2 text-sm text-gray-700">
        <h1 className="text-lg font-semibold">Configurazione incompleta</h1>
        <p>Mancano le variabili <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.</p>
        <p>In sviluppo vanno nel file <code>.env</code>; su Cloudflare Pages in <em>Settings → Environment variables</em>, seguite da un nuovo deploy.</p>
      </div>
    </main>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.ruolo !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const inizializzazione = useAuthStore((s) => s.inizializzazione);
  const inizializza = useAuthStore((s) => s.inizializza);

  useEffect(() => {
    if (!configurazioneMancante) inizializza();
  }, [inizializza]);

  if (configurazioneMancante) return <ConfigurazioneMancante />;
  if (inizializzazione) return <Caricamento />;

  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors />
      <Suspense fallback={<Caricamento />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/nuova-password" element={<NuovaPassword />} />
          <Route path="/copyright" element={<CopyrightLicenza />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <Suspense fallback={<Caricamento />}>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />

                      {/* Bandi */}
                      <Route path="/bandi" element={<BandiList />} />
                      <Route path="/bandi/:id" element={<BandoDetail />} />
                      <Route path="/bandi/:bandoId/domande" element={<DomandeList />} />
                      <Route path="/domande" element={<DomandeList />} />
                      <Route path="/domande/:id" element={<DomandaDetail />} />

                      {/* Organi Sociali */}
                      <Route path="/soci" element={<SociList />} />
                      <Route path="/sedute" element={<SedutaList />} />
                      <Route path="/sedute/:id" element={<SedutaDetail />} />
                      <Route path="/delibere" element={<DelibereList />} />
                      <Route path="/quote" element={<QuoteList />} />
                      <Route path="/componenti" element={<ComponentiList />} />

                      {/* Rendicontazione */}
                      <Route path="/giustificativi" element={<GiustificativiList />} />
                      <Route path="/giustificativi/:id" element={<GiustificativoDetail />} />
                      <Route path="/report-ses" element={<ReportSes />} />
                      <Route path="/fornitori" element={<FornitoriList />} />
                      <Route path="/previsione" element={<PrevisioneList />} />
                      <Route path="/quadro-rendicontazione" element={<QuadroRendicontazione />} />

                      {/* Report */}
                      <Route path="/report" element={<ReportPage />} />

                      {/* Acquisti */}
                      <Route path="/procedure" element={<ProcedureList />} />
                      <Route path="/procedure/:id" element={<ProceduraDetail />} />
                      <Route path="/contratti" element={<ContrattiList />} />
                      <Route path="/contratti/:id" element={<ContrattoDetail />} />
                      <Route path="/soglie" element={<SoglieCalcolo />} />

                      {/* Archivio */}
                      <Route path="/registro-catalogazione" element={<RegistroCatalogazione />} />

                      {/* Agenda scadenze */}
                      <Route path="/agenda" element={<AgendaPage />} />
                      <Route path="/agenda/:id" element={<PraticaDetail />} />

                      {/* Scadenzario pagamenti, cash flow, esportazione */}
                      <Route path="/scadenzario" element={<ScadenzarioPage />} />
                      <Route path="/scadenzario/:id" element={<ScadenzaDetail />} />
                      <Route path="/cash-flow" element={<CashFlowPage />} />
                      <Route path="/esporta-excel" element={<EsportaExcel />} />

                      {/* Amministrazione */}
                      <Route path="/utenti" element={<AdminRoute><UsersAdmin /></AdminRoute>} />
                      <Route path="/audit" element={<AdminRoute><AuditLog /></AdminRoute>} />
                      <Route path="/impostazioni" element={<Impostazioni />} />
                      <Route path="/backup" element={<AdminRoute><BackupRestore /></AdminRoute>} />

                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                </MainLayout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
