// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore, ROLE_LABELS, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import {
  LayoutDashboard, ScrollText, Users, ShoppingCart,
  Settings, LogOut, ChevronDown, ChevronRight, Activity,
  FileSpreadsheet, BarChart2, Building2, DatabaseBackup, Archive, AlertTriangle,
  CalendarCheck, Wallet, Sheet
} from "lucide-react";
import { useState, useEffect } from "react";
import clsx from "clsx";
import { InfoSoftware } from "../InfoSoftware";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path?: string;
  children?: { label: string; path: string }[];
  module?: string;
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: <LayoutDashboard size={18} />, path: "/" },
  { label: "Agenda scadenze", icon: <CalendarCheck size={18} />, path: "/agenda" },
  {
    label: "Pagamenti",
    icon: <Wallet size={18} />,
    module: "pagamenti",
    children: [
      { label: "Scadenzario pagamenti", path: "/scadenzario" },
      { label: "Mandati di pagamento", path: "/mandati" },
      { label: "Cash flow", path: "/cash-flow" },
    ],
  },
  {
    label: "Bandi",
    icon: <ScrollText size={18} />,
    module: "bandi",
    children: [
      { label: "Schemi di bando", path: "/schemi-bando" },
      { label: "Bandi attivi", path: "/bandi" },
      { label: "Domande di sostegno", path: "/domande" },
    ],
  },
  {
    label: "Organi Sociali",
    icon: <Users size={18} />,
    module: "organi",
    children: [
      { label: "Libro soci", path: "/soci" },
      { label: "Quote sociali", path: "/quote" },
      { label: "Sedute", path: "/sedute" },
      { label: "Delibere", path: "/delibere" },
      { label: "Componenti", path: "/componenti" },
    ],
  },
  {
    label: "Rendicontazione",
    icon: <FileSpreadsheet size={18} />,
    module: "rend",
    children: [
      { label: "Giustificativi", path: "/giustificativi" },
      { label: "Fornitori", path: "/fornitori" },
      { label: "Previsione", path: "/previsione" },
      { label: "Quadro rendicontazione", path: "/quadro-rendicontazione" },
      { label: "Report SES", path: "/report-ses" },
    ],
  },
  { label: "Report", icon: <BarChart2 size={18} />, path: "/report" },
  { label: "Esporta in Excel", icon: <Sheet size={18} />, path: "/esporta-excel" },
  {
    label: "Procedure Acquisto",
    icon: <ShoppingCart size={18} />,
    module: "acquisti",
    children: [
      { label: "Procedure", path: "/procedure" },
      { label: "Contratti", path: "/contratti" },
      { label: "Calcolo soglie CCP", path: "/soglie" },
    ],
  },
  {
    label: "Archivio",
    icon: <Archive size={18} />,
    module: "archivio",
    children: [
      { label: "Registro di catalogazione", path: "/registro-catalogazione" },
    ],
  },
];

const adminItems: NavItem[] = [
  { label: "Utenti", icon: <Users size={18} />, path: "/utenti" },
  { label: "Registro attività", icon: <Activity size={18} />, path: "/audit" },
  { label: "Impostazioni e dati GAL", icon: <Settings size={18} />, path: "/impostazioni" },
  { label: "Backup & Ripristino", icon: <DatabaseBackup size={18} />, path: "/backup" },
];

function NavGroup({ item, expanded, onToggle, location }: {
  item: NavItem;
  expanded: boolean;
  onToggle: () => void;
  location: { pathname: string };
}) {
  const isActive = item.children
    ? item.children.some((c) => location.pathname.startsWith(c.path))
    : item.path === "/" ? location.pathname === "/" : location.pathname === item.path || location.pathname.startsWith(item.path + "/");

  if (item.path && !item.children) {
    return (
      <Link
        to={item.path}
        className={clsx(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
          isActive ? "bg-primary-600 text-white" : "text-slate-300 hover:bg-slate-700 hover:text-white"
        )}
      >
        {item.icon}
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={onToggle}
        className={clsx(
          "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
          isActive ? "bg-slate-700 text-white" : "text-slate-300 hover:bg-slate-700 hover:text-white"
        )}
      >
        <span className="flex items-center gap-3">{item.icon}{item.label}</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && item.children && (
        <div className="ml-6 mt-1 space-y-0.5">
          {item.children.map((child) => (
            <Link
              key={child.path}
              to={child.path}
              className={clsx(
                "block px-3 py-2 rounded-lg text-sm transition-colors",
                location.pathname === child.path || location.pathname.startsWith(child.path + "/")
                  ? "bg-primary-600 text-white font-medium"
                  : "text-slate-400 hover:bg-slate-700 hover:text-white"
              )}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();
  const currentGal = useGalStore((st) => st.currentGal);
  const caricaGal = useGalStore((st) => st.carica);
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set(["pagamenti", "bandi"]));

  // Dati dell'unico GAL di questa installazione
  useEffect(() => {
    if (user) caricaGal();
  }, [user?.id, caricaGal]);

  function toggleModule(module: string) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module); else next.add(module);
      return next;
    });
  }

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <a href="#contenuto" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:p-2 focus:bg-white focus:text-primary-700 focus:rounded">
        Vai al contenuto
      </a>
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-500 flex items-center justify-center font-bold text-white text-lg">G</div>
            <div>
              <div className="text-white font-semibold text-sm">GAL OS</div>
              <div className="text-slate-400 text-xs">{currentGal?.nome ?? "Gestione GAL"}</div>
            </div>
          </div>
        </div>


        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1" aria-label="Menu principale">
          {navItems.map((item) => (
            <NavGroup
              key={item.label}
              item={item}
              expanded={item.module ? expandedModules.has(item.module) : false}
              onToggle={() => item.module && toggleModule(item.module)}
              location={location}
            />
          ))}

          {isAdmin(user) && (
            <>
              <div className="pt-3 pb-1">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3">
                  Amministrazione
                </div>
              </div>
              {adminItems.map((item) => (
                <NavGroup
                  key={item.label}
                  item={item}
                  expanded={false}
                  onToggle={() => {}}
                  location={location}
                />
              ))}
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {user?.nome_completo?.[0]?.toUpperCase() ?? "U"}
              </div>
              <div className="min-w-0">
                <div className="text-white text-xs font-medium truncate">{user?.nome_completo}</div>
                <div className="text-slate-400 text-xs truncate">{user ? ROLE_LABELS[user.ruolo] : ""}</div>
              </div>
            </div>
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-400 transition-colors p-1" title="Esci" aria-label="Esci">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {navItems.find((n) =>
                n.children
                  ? n.children.some((c) => location.pathname.startsWith(c.path))
                  : n.path === "/" ? location.pathname === "/" : location.pathname.startsWith(n.path ?? "")
              )?.label ?? adminItems.find(a => location.pathname.startsWith(a.path ?? ""))?.label ?? ""}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-400">
            {currentGal && (
              <span className="hidden md:flex items-center gap-1.5 bg-gray-100 px-2.5 py-1 rounded-full text-xs">
                <Building2 size={12} />
                {currentGal.nome}
              </span>
            )}
          </div>
        </header>

        {/* Content */}
        <div id="contenuto" className="flex-1 overflow-auto p-6 flex flex-col">
          {isAdmin(user) && currentGal?.nome === "GAL da configurare" && (
            <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center gap-2" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              Primo avvio: inserisci i dati del GAL (nome, codice fiscale, indirizzo) in
              <Link to="/impostazioni" className="underline font-medium">Impostazioni e dati GAL</Link>.
            </div>
          )}
          <div className="flex-1">{children}</div>
          <footer className="pt-6 mt-6 border-t border-gray-100">
            <InfoSoftware />
          </footer>
        </div>
      </main>
    </div>
  );
}
