// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "../stores/auth";
import { NOME_ENTE } from "../stores/gal";
import { supabase } from "../lib/supabase";
import { InfoSoftware } from "../components/InfoSoftware";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recupero, setRecupero] = useState(false);
  const [invio, setInvio] = useState(false);
  const { user, login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate("/");
    } catch {
      // il messaggio è nello store
    }
  }

  async function inviaRecupero(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setInvio(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/nuova-password` });
    setInvio(false);
    if (err) console.error(err);
    // Stesso messaggio in ogni caso: non si rivela se l'e-mail è registrata
    toast.success("Se l'indirizzo è abilitato, riceverai un'e-mail con il link per scegliere una nuova password.");
    setRecupero(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-primary-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary-500 shadow-lg mb-4" aria-hidden="true">
            <span className="text-3xl font-bold text-white">G</span>
          </div>
          <h1 className="text-3xl font-bold text-white">GAL OS</h1>
          <p className="text-primary-200 mt-1">{NOME_ENTE}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">{recupero ? "Recupera la password" : "Accedi"}</h2>

          {error && !recupero && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm" role="alert">
              {error}
            </div>
          )}

          {recupero ? (
            <form onSubmit={inviaRecupero} className="space-y-4">
              <p className="text-sm text-gray-600">Indica l'e-mail con cui accedi: riceverai un link per scegliere una nuova password.</p>
              <div>
                <label className="label" htmlFor="email-recupero">E-mail</label>
                <input id="email-recupero" className="input" type="email" autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-3" disabled={invio}>
                {invio && <Loader2 size={16} className="animate-spin" />} Invia il link
              </button>
              <button type="button" className="text-sm text-primary-700 hover:underline" onClick={() => setRecupero(false)}>
                Torna all'accesso
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label" htmlFor="email">E-mail</label>
                <input id="email" className="input" type="email" autoComplete="username" value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError(); }} autoFocus required />
              </div>
              <div>
                <label className="label" htmlFor="password">Password</label>
                <input id="password" className="input" type="password" autoComplete="current-password" value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError(); }} required />
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-3" disabled={isLoading}>
                {isLoading && <Loader2 size={16} className="animate-spin" />}
                {isLoading ? "Accesso in corso…" : "Accedi"}
              </button>
              <button type="button" className="text-sm text-primary-700 hover:underline" onClick={() => { clearError(); setRecupero(true); }}>
                Password dimenticata?
              </button>
            </form>
          )}
        </div>

        <InfoSoftware className="text-center mt-6" scuro />
      </div>
    </main>
  );
}
