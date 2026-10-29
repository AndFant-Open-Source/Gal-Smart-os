// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Upload, FileDown, Hash, Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, isAdmin } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { logAudit, messaggioErrore } from "../../lib/utils";
import { BUCKET_DOCUMENTI } from "../../constants";
import { ibanValido } from "../../lib/mandati/controlli";
import {
  PERCORSO_LOGO, caricaEnte, caricaImpostazioni, generaWord, isPng, scaricaFile, schedaVuota, uniscinote,
} from "../../lib/mandati/servizio";
import type { ImpostazioniMandati as Impostazioni } from "../../types";

type Campi = Pick<Impostazioni, "iban_addebito" | "banca_tesoriere" | "pratica" | "operazione" | "misura" | "cup" | "firma_sinistra" | "firma_destra">;
const CAMPI: { k: keyof Campi; label: string; aiuto?: string }[] = [
  { k: "iban_addebito", label: "IBAN del conto di addebito del GAL", aiuto: "Il conto su cui il tesoriere addebita i pagamenti" },
  { k: "banca_tesoriere", label: "Banca tesoriere", aiuto: "Compare nel titolo: «Ordine di pagamento alla …»" },
  { k: "pratica", label: "Pratica / provvedimento di aiuti", aiuto: "es. SRG06X-00: compare nel piè di pagina e in «Provvedimento Aiuti n. …»" },
  { k: "operazione", label: "Operazione", aiuto: "es. SRG06" },
  { k: "misura", label: "Misura (proposta su ogni mandato)" },
  { k: "cup", label: "CUP di progetto", aiuto: "Usato quando la fattura non indica il CUP (con nota da verificare)" },
  { k: "firma_sinistra", label: "Firma a sinistra", aiuto: "es. Il Presidente (Nome Cognome)" },
  { k: "firma_destra", label: "Firma a destra", aiuto: "es. Il RAF (Nome Cognome)" },
];

export default function ImpostazioniMandati() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const gal = useGalStore((s) => s.currentGal);
  const admin = isAdmin(user);
  const anno = new Date().getFullYear();

  const [imp, setImp] = useState<Impostazioni | null>(null);
  const [form, setForm] = useState<Campi | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "salva" | "logo" | "numero" | "prova">("");
  const [annoNum, setAnnoNum] = useState(anno);
  const [ultimo, setUltimo] = useState("");
  const [proposto, setProposto] = useState<number | null>(null);

  async function load() {
    try {
      const i = await caricaImpostazioni();
      setImp(i);
      if (i) setForm({ iban_addebito: i.iban_addebito, banca_tesoriere: i.banca_tesoriere, pratica: i.pratica, operazione: i.operazione, misura: i.misura, cup: i.cup, firma_sinistra: i.firma_sinistra, firma_destra: i.firma_destra });
      if (i?.logo_path) {
        const { data } = await supabase.storage.from(BUCKET_DOCUMENTI).createSignedUrl(i.logo_path, 3600);
        setLogoUrl(data?.signedUrl ?? null);
      } else setLogoUrl(null);
    } catch (e) {
      toast.error(messaggioErrore(e, "Impossibile caricare le impostazioni dei mandati"));
    }
  }

  async function caricaProposto(a: number) {
    const { data, error } = await supabase.rpc("gal_mandati_numero_proposto", { p_anno: a });
    if (error) { console.error(error); setProposto(null); return; }
    setProposto(typeof data === "number" ? data : null);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { caricaProposto(annoNum); }, [annoNum]);

  async function salva(e: React.FormEvent) {
    e.preventDefault();
    if (!imp || !form || !user || !gal) return;
    if (form.iban_addebito && !ibanValido(form.iban_addebito)) {
      toast.error("L'IBAN del conto di addebito non è valido: controlla le cifre");
      return;
    }
    setBusy("salva");
    const pulito = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" && v.trim() ? v.trim() : null]));
    const { error } = await supabase.from("gal_mandati_impostazioni").update(pulito).eq("id", imp.id);
    setBusy("");
    if (error) { toast.error(messaggioErrore(error, "Impostazioni non salvate")); return; }
    await logAudit({ galId: gal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "impostazioni_mandati", entitaId: imp.id, descrizione: "Impostazioni dei mandati aggiornate" });
    toast.success("Impostazioni dei mandati salvate");
    load();
  }

  async function caricaLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !imp) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPng(bytes)) { toast.error("Il logo deve essere un'immagine PNG"); return; }
    if (bytes.length > 2 * 1024 * 1024) { toast.error("Il logo è troppo grande (massimo 2 MB)"); return; }
    setBusy("logo");
    const { error } = await supabase.storage.from(BUCKET_DOCUMENTI).upload(PERCORSO_LOGO, file, { upsert: true, contentType: "image/png" });
    if (error) { setBusy(""); toast.error(messaggioErrore(error, "Logo non caricato")); return; }
    const { error: e2 } = await supabase.from("gal_mandati_impostazioni").update({ logo_path: PERCORSO_LOGO }).eq("id", imp.id);
    setBusy("");
    if (e2) { toast.error(messaggioErrore(e2, "Logo non collegato alle impostazioni")); return; }
    toast.success("Logo aggiornato: verrà usato in tutti i nuovi mandati");
    load();
  }

  async function impostaNumero(e: React.FormEvent) {
    e.preventDefault();
    const n = parseInt(ultimo, 10);
    if (!Number.isInteger(n) || n < 0) { toast.error("Indica un numero intero (0 se nessun mandato è stato emesso)"); return; }
    setBusy("numero");
    const { data, error } = await supabase.rpc("gal_mandati_imposta_ultimo_numero", { p_anno: annoNum, p_ultimo: n });
    setBusy("");
    if (error) { toast.error(messaggioErrore(error, "Numerazione non aggiornata")); return; }
    if (user && gal) await logAudit({ galId: gal.id, userId: user.id, username: user.nome_completo, azione: "UPDATE", entita: "impostazioni_mandati", descrizione: `Numerazione mandati ${annoNum}: ultimo emesso ${n}` });
    toast.success(`Numerazione impostata: il prossimo mandato del ${annoNum} sarà il n. ${data}/${annoNum}`);
    setUltimo("");
    caricaProposto(annoNum);
  }

  async function wordDiProva() {
    if (!gal) return;
    setBusy("prova");
    try {
      const ente = await caricaEnte(gal, imp);
      const oggi = new Date().toISOString().slice(0, 10);
      const scheda = uniscinote({
        ...schedaVuota(imp),
        beneficiario_nome: "Fornitore di prova S.r.l.",
        beneficiario_piva: "01234567890",
        beneficiario_indirizzo: "Via Roma 1 - 00100 Roma (RM)",
        voci: [{ voce: "Servizio di prova", importo: 100 }, { voce: "IVA 22%", importo: 22 }, { voce: "Totale documento", importo: 122, grassetto: true }],
        netto: 122,
        causale: "Mandato di prova per controllare intestazione, logo e firme",
      }, oggi);
      const blob = await generaWord({ scheda, numero: 0, anno, data_ordine: oggi, stato: "bozza" }, ente);
      scaricaFile(blob, "Mandato_di_prova.docx");
      toast.success("Word di prova scaricato: aprilo per controllare la grafica");
    } catch (e) {
      toast.error(messaggioErrore(e, "Impossibile generare il Word di prova"));
    } finally {
      setBusy("");
    }
  }

  if (!form) {
    return <div className="flex items-center justify-center gap-2 text-gray-500 py-20" role="status"><Loader2 className="animate-spin" size={18} aria-hidden="true" /> Caricamento impostazioni…</div>;
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-start gap-3">
        <button className="btn-ghost p-1.5 mt-0.5" onClick={() => navigate("/mandati")} aria-label="Torna ai mandati" title="Torna ai mandati"><ArrowLeft size={18} aria-hidden="true" /></button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Impostazioni dei mandati</h1>
          <p className="text-sm text-gray-600">
            Intestazione, conto di addebito, firme e numerazione. Nome, indirizzo, C.F. e PEC del GAL si modificano in{" "}
            <Link to="/impostazioni" className="text-primary-700 hover:underline">Impostazioni e dati GAL</Link>.
            {!admin && " Solo un amministratore può modificare questi dati."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <form onSubmit={salva} className="card p-5 space-y-4 lg:col-span-2" aria-labelledby="titolo-dati-stampa">
          <h2 id="titolo-dati-stampa" className="font-semibold text-gray-900">Dati stampati sul mandato</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CAMPI.map((c) => (
              <div key={c.k} className={c.k === "iban_addebito" ? "md:col-span-2" : ""}>
                <label htmlFor={`imp-${c.k}`} className="label">{c.label}</label>
                <input id={`imp-${c.k}`} className="input" value={form[c.k] ?? ""} disabled={!admin}
                  aria-describedby={c.aiuto ? `imp-${c.k}-aiuto` : undefined}
                  onChange={(e) => setForm({ ...form, [c.k]: c.k === "iban_addebito" ? e.target.value.toUpperCase() : e.target.value })} />
                {c.aiuto && <p id={`imp-${c.k}-aiuto`} className="text-xs text-gray-600 mt-1">{c.aiuto}</p>}
              </div>
            ))}
          </div>
          {admin && (
            <button type="submit" className="btn-primary" disabled={busy === "salva"}>
              {busy === "salva" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Salva impostazioni
            </button>
          )}
        </form>

        <div className="space-y-5">
          <section className="card p-5 space-y-3" aria-labelledby="titolo-logo">
            <h2 id="titolo-logo" className="font-semibold text-gray-900">Logo nell'intestazione</h2>
            {logoUrl
              ? <img src={logoUrl} alt={`Logo attuale di ${gal?.nome ?? "GAL"}`} className="max-h-20 border rounded p-1 bg-white" />
              : <p className="text-sm text-gray-600">Nessun logo caricato: viene usato quello del modello Word.</p>}
            <p className="text-xs text-gray-600">Immagine PNG. Nel mandato è alta 2 cm; la larghezza segue le proporzioni.</p>
            {admin && (
              <label className="btn-secondary cursor-pointer w-fit">
                {busy === "logo" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
                {logoUrl ? "Sostituisci logo" : "Carica logo"}
                <input type="file" accept="image/png" className="sr-only" onChange={caricaLogo} disabled={busy === "logo"} />
              </label>
            )}
          </section>

          <section className="card p-5 space-y-3" aria-labelledby="titolo-numerazione">
            <h2 id="titolo-numerazione" className="font-semibold text-gray-900 flex items-center gap-2"><Hash size={18} aria-hidden="true" /> Numerazione</h2>
            <div>
              <label htmlFor="num-anno" className="label">Anno</label>
              <input id="num-anno" type="number" className="input w-32" value={annoNum} min={2000} max={2100}
                onChange={(e) => setAnnoNum(parseInt(e.target.value, 10) || anno)} />
            </div>
            <p className="text-sm text-gray-800" aria-live="polite">
              Prossimo numero: <strong>{proposto !== null ? `${proposto}/${annoNum}` : "—"}</strong>
            </p>
            {admin && (
              <form onSubmit={impostaNumero} className="space-y-2">
                <label htmlFor="num-ultimo" className="label">Ultimo mandato già emesso a mano nel {annoNum}</label>
                <div className="flex gap-2">
                  <input id="num-ultimo" type="number" min={0} className="input w-28" value={ultimo} onChange={(e) => setUltimo(e.target.value)} />
                  <button type="submit" className="btn-secondary" disabled={busy === "numero" || ultimo === ""}>Imposta</button>
                </div>
                <p className="text-xs text-gray-600">Serve solo per ripartire dal numero giusto. Poi la numerazione prosegue da sola.</p>
              </form>
            )}
          </section>

          <section className="card p-5 space-y-2" aria-labelledby="titolo-prova">
            <h2 id="titolo-prova" className="font-semibold text-gray-900">Controllo grafico</h2>
            <p className="text-sm text-gray-600">Scarica un mandato di esempio con i dati attuali per controllare intestazione, logo e firme.</p>
            <button className="btn-secondary" onClick={wordDiProva} disabled={busy === "prova"}>
              {busy === "prova" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileDown size={16} aria-hidden="true" />} Scarica Word di prova
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
