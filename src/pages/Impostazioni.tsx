// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuthStore, isAdmin, ROLE_LABELS } from "../stores/auth";
import { useGalStore } from "../stores/gal";
import { logAudit, messaggioErrore } from "../lib/utils";
import { toast } from "sonner";
import { Save, Settings2, Building2, User } from "lucide-react";
import type { Gal } from "../types";

export default function Impostazioni() {
  const user = useAuthStore((s) => s.user);
  const currentGal = useGalStore((s) => s.currentGal);
  const setCurrentGal = useGalStore((s) => s.setCurrentGal);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const admin = isAdmin(user);

  const [galForm, setGalForm] = useState<Partial<Gal>>({});
  const [profileForm, setProfileForm] = useState({ nome_completo: "", email: "" });
  const [savingGal, setSavingGal] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (currentGal) setGalForm({ ...currentGal });
    if (user) setProfileForm({ nome_completo: user.nome_completo, email: user.email ?? "" });
  }, [currentGal, user]);

  async function handleSaveGal(e: React.FormEvent) {
    e.preventDefault();
    if (!currentGal || !user) return;
    setSavingGal(true);
    const { data, error } = await supabase.from("gal_gal").update({
      nome: (galForm.nome ?? "").trim(),
      codice: galForm.codice || null,
      codice_fiscale: galForm.codice_fiscale || null,
      partita_iva: galForm.partita_iva || null,
      regione: galForm.regione || null,
      indirizzo: galForm.indirizzo || null,
      email: galForm.email || null,
      pec: galForm.pec || null,
      telefono: galForm.telefono || null,
      sito_web: galForm.sito_web || null,
    }).eq("id", currentGal.id).select().single();
    if (error) { toast.error(messaggioErrore(error)); setSavingGal(false); return; }
    if (data) setCurrentGal(data as Gal);
    await logAudit({ galId: currentGal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "gal", descrizione: galForm.nome ?? "" });
    toast.success("Dati GAL aggiornati");
    setSavingGal(false);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    const { error } = await supabase.from("gal_profili").update({
      nome_completo: profileForm.nome_completo,
    }).eq("id", user.id);
    if (error) { toast.error(messaggioErrore(error)); setSavingProfile(false); return; }
    await refreshUser();
    toast.success("Profilo aggiornato");
    setSavingProfile(false);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">Impostazioni</h1>
        <p className="text-sm text-gray-500">Configurazione applicazione e profilo</p>
      </div>

      {/* Profilo utente */}
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><User size={16} className="text-green-700" /> Il mio profilo</h2>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="label" htmlFor="imp-nome">Nome completo</label>
            <input id="imp-nome" className="input" value={profileForm.nome_completo} onChange={(e) => setProfileForm({ ...profileForm, nome_completo: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="imp-email">E-mail (sola lettura)</label>
            <input id="imp-email" className="input bg-gray-50" value={profileForm.email} readOnly />
          </div>
          <div>
            <label className="label" htmlFor="imp-ruolo">Ruolo</label>
            <input id="imp-ruolo" className="input bg-gray-50" value={user ? ROLE_LABELS[user.ruolo] : ""} readOnly />
          </div>
          <button type="submit" className="btn-primary" disabled={savingProfile}><Save size={16} /> {savingProfile ? "Salvataggio..." : "Salva profilo"}</button>
        </form>
      </div>

      {/* Dati GAL */}
      {currentGal && admin && (
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><Building2 size={16} className="text-green-700" /> Dati del GAL</h2>
          <p className="text-xs text-gray-500">Compaiono nelle intestazioni dei PDF e nella scheda per il mandato di pagamento.</p>
          <form onSubmit={handleSaveGal} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Nome *</label><input className="input" required value={galForm.nome ?? ""} onChange={(e) => setGalForm({ ...galForm, nome: e.target.value })} /></div>
              <div><label className="label">Codice</label><input className="input" value={galForm.codice ?? ""} onChange={(e) => setGalForm({ ...galForm, codice: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Codice fiscale</label><input className="input font-mono" value={galForm.codice_fiscale ?? ""} onChange={(e) => setGalForm({ ...galForm, codice_fiscale: e.target.value.toUpperCase() })} /></div>
              <div><label className="label">Partita IVA</label><input className="input font-mono" value={galForm.partita_iva ?? ""} onChange={(e) => setGalForm({ ...galForm, partita_iva: e.target.value })} /></div>
            </div>
            <div><label className="label">Regione</label><input className="input" value={galForm.regione ?? ""} onChange={(e) => setGalForm({ ...galForm, regione: e.target.value })} /></div>
            <div><label className="label">Indirizzo</label><input className="input" value={galForm.indirizzo ?? ""} onChange={(e) => setGalForm({ ...galForm, indirizzo: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Email</label><input className="input" type="email" value={galForm.email ?? ""} onChange={(e) => setGalForm({ ...galForm, email: e.target.value })} /></div>
              <div><label className="label">PEC</label><input className="input" type="email" value={galForm.pec ?? ""} onChange={(e) => setGalForm({ ...galForm, pec: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Telefono</label><input className="input" value={galForm.telefono ?? ""} onChange={(e) => setGalForm({ ...galForm, telefono: e.target.value })} /></div>
              <div><label className="label">Sito Web</label><input className="input" value={galForm.sito_web ?? ""} onChange={(e) => setGalForm({ ...galForm, sito_web: e.target.value })} /></div>
            </div>
            <button type="submit" className="btn-primary" disabled={savingGal}><Save size={16} /> {savingGal ? "Salvataggio..." : "Salva dati GAL"}</button>
          </form>
        </div>
      )}

      {/* App info */}
      <div className="card p-6 space-y-2">
        <h2 className="font-semibold flex items-center gap-2"><Settings2 size={16} className="text-green-700" /> Informazioni</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Applicazione</dt><dd>GAL OS — edizione per singolo GAL</dd>
          <dt className="text-gray-500">Versione</dt><dd>{__VERSIONE_APP__}</dd>
          <dt className="text-gray-500">GAL</dt><dd>{currentGal?.nome ?? "—"}</dd>
          <dt className="text-gray-500">Licenza</dt><dd>AGPL-3.0-or-later con termini aggiuntivi</dd>
        </dl>
      </div>
    </div>
  );
}
