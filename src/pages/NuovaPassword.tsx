// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { NOME_ENTE } from "../stores/gal";
import { InfoSoftware } from "../components/InfoSoftware";

/**
 * Scelta della password per chi arriva da un link ricevuto per e-mail:
 * invito alla piattaforma (Authentication → Invite user) o recupero password.
 * Il link apre una sessione temporanea; qui si imposta la password e si torna all'accesso.
 */
export default function NuovaPassword() {
  const navigate = useNavigate();
  const [sessione, setSessione] = useState<"verifica" | "ok" | "assente">("verifica");
  const [password, setPassword] = useState("");
  const [conferma, setConferma] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let attivo = true;
    // Il client Supabase legge il codice dal link (detectSessionInUrl): attende un istante
    const verifica = async () => {
      for (let i = 0; i < 10 && attivo; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) { setSessione("ok"); return; }
        await new Promise((r) => setTimeout(r, 300));
      }
      if (attivo) setSessione("assente");
    };
    verifica();
    return () => { attivo = false; };
  }, []);

  const errori: string[] = [];
  if (password && password.length < 10) errori.push("Almeno 10 caratteri");
  if (password && !(/[A-Za-z]/.test(password) && /\d/.test(password))) errori.push("Usa lettere e numeri");
  if (conferma && conferma !== password) errori.push("Le due password non coincidono");

  async function salva(e: React.FormEvent) {
    e.preventDefault();
    if (!password || errori.length || conferma !== password) return;
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(/same/i.test(error.message) ? "La nuova password deve essere diversa dalla precedente." : "Impossibile salvare la password: il link potrebbe essere scaduto.");
      return;
    }
    await supabase.auth.signOut();
    toast.success("Password impostata. Ora puoi accedere.");
    navigate("/login", { replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 to-primary-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">{NOME_ENTE}</h1>
          <p className="text-primary-200 mt-1">Imposta la tua password</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {sessione === "verifica" && (
            <div className="flex items-center gap-2 text-gray-500"><Loader2 className="animate-spin" size={18} /> Verifica del link…</div>
          )}
          {sessione === "assente" && (
            <div className="space-y-4 text-sm text-gray-700">
              <p>Il link non è valido o è scaduto.</p>
              <p>Chiedi all'amministratore del GAL di inviarti un nuovo invito o una nuova e-mail di reimpostazione.</p>
              <button className="btn-secondary" onClick={() => navigate("/login")}>Torna all'accesso</button>
            </div>
          )}
          {sessione === "ok" && (
            <form onSubmit={salva} className="space-y-4">
              <div>
                <label className="label" htmlFor="nuova-password">Nuova password</label>
                <input id="nuova-password" type="password" autoComplete="new-password" className="input" value={password}
                  onChange={(e) => setPassword(e.target.value)} required minLength={10} />
              </div>
              <div>
                <label className="label" htmlFor="conferma-password">Ripeti la password</label>
                <input id="conferma-password" type="password" autoComplete="new-password" className="input" value={conferma}
                  onChange={(e) => setConferma(e.target.value)} required />
              </div>
              {errori.length > 0 && (
                <ul className="text-xs text-red-700 list-disc pl-5" aria-live="polite">{errori.map((x) => <li key={x}>{x}</li>)}</ul>
              )}
              <button type="submit" className="btn-primary w-full justify-center" disabled={saving || !password || errori.length > 0 || conferma !== password}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Salva la password
              </button>
            </form>
          )}
        </div>
        <InfoSoftware className="text-center mt-6" scuro />
      </div>
    </main>
  );
}
