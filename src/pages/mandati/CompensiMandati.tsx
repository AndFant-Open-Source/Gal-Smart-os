// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Distinta compensi (gettoni CdA, commissioni, revisori): per ogni percettore un mandato
 * del NETTO e, se richiesto, il mandato F24 collegato (INPS Gestione Separata + IRPEF).
 * Regole di calcolo: src/lib/mandati/compensi.ts (collaudate sul kit).
 * I mandati nascono in bozza: vanno controllati e confermati come gli altri.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Users, Loader2, FileArchive, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuthStore, canWrite } from "../../stores/auth";
import { useGalStore } from "../../stores/gal";
import { formatCurrency, formatDate, logAudit, messaggioErrore } from "../../lib/utils";
import { oggiISO, scadenzaF24 } from "../../lib/scadenze";
import { calcolaCompenso, schedaF24Compenso, schedaNettoCompenso, type DatiCompenso } from "../../lib/mandati/compensi";
import { ibanValido } from "../../lib/mandati/controlli";
import type { SchedaMandato } from "../../lib/mandati/tipi";
import {
  NOTA_ALLEGATI_COMPENSO, applicaImpostazioni, caricaEnte, caricaImpostazioni, compensiGiaEmessi, numeroStampa,
  scaricaFile, uniscinote, ultimoPercettore, zipWord,
} from "../../lib/mandati/servizio";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import type { ImpostazioniMandati, Mandato } from "../../types";

const RUOLI = [
  "Gettoni di presenza sedute del Consiglio di Amministrazione",
  "Compenso componente Commissione",
  "Compenso componente Collegio dei Revisori dei Conti",
];

interface Riga {
  chiave: number;
  nome: string;
  cf: string;
  ruolo: string;
  lordo: number;
  aliquota: number;   // percentuale, es. 24
  irpef: number;
  iban: string;
}

let prossimaChiave = 1;
const rigaVuota = (ruolo = RUOLI[0]): Riga => ({ chiave: prossimaChiave++, nome: "", cf: "", ruolo, lordo: 0, aliquota: 24, irpef: 0, iban: "" });

const mesi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const periodoCorrente = () => { const d = new Date(); return `${mesi[d.getMonth()]} ${d.getFullYear()}`; };
const dataIt = (iso: string) => iso.split("-").reverse().join("/");

export default function CompensiMandati() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const gal = useGalStore((s) => s.currentGal);
  const write = canWrite(user);

  const [imp, setImp] = useState<ImpostazioniMandati | null>(null);
  const [righe, setRighe] = useState<Riga[]>([rigaVuota()]);
  const [periodo, setPeriodo] = useState(periodoCorrente());
  const [dataOrdine, setDataOrdine] = useState(oggiISO());
  const [scadenza, setScadenza] = useState(scadenzaF24(oggiISO()));
  const [cup, setCup] = useState("");
  const [rifDistinta, setRifDistinta] = useState("");
  const [delAmmissione, setDelAmmissione] = useState("");
  const [delAutorizzazione, setDelAutorizzazione] = useState("");
  const [conF24, setConF24] = useState(true);
  const [delibere, setDelibere] = useState<string[]>([]);
  const [avanzamento, setAvanzamento] = useState<{ fatti: number; totale: number; testo: string } | null>(null);
  const [creati, setCreati] = useState<Mandato[]>([]);
  const [errori, setErrori] = useState<string[]>([]);
  const [doppi, setDoppi] = useState<string[] | null>(null);

  useEffect(() => {
    caricaImpostazioni().then((i) => { setImp(i); setCup(i?.cup ?? ""); }).catch((e) => toast.error(messaggioErrore(e, "Impostazioni dei mandati non caricate")));
    supabase.from("gal_delibere").select("numero, anno, data_delibera, oggetto").order("data_delibera", { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (error) { console.error(error); return; }
        setDelibere((data ?? []).map((d: { numero: string | null; anno: number | null; data_delibera: string | null; oggetto: string | null }) =>
          [`Delibera CdA n. ${d.numero ?? "?"}${d.anno ? `/${d.anno}` : ""}`, d.data_delibera && `del ${formatDate(d.data_delibera)}`, d.oggetto && `- ${d.oggetto.slice(0, 80)}`].filter(Boolean).join(" ")));
      });
  }, []);

  useEffect(() => { setScadenza(scadenzaF24(dataOrdine)); }, [dataOrdine]);

  const setRiga = (k: number, patch: Partial<Riga>) => setRighe((rr) => rr.map((r) => (r.chiave === k ? { ...r, ...patch } : r)));
  const datiDa = (r: Riga): DatiCompenso => ({
    nome: r.nome.trim(), cf: r.cf.trim().toUpperCase() || undefined, ruolo: r.ruolo.trim(), periodo: periodo.trim(),
    lordo: r.lordo, aliquota_gs: r.aliquota / 100, irpef: r.irpef,
    iban: r.iban.replace(/\s+/g, "").toUpperCase() || undefined, cup: cup.trim() || undefined, rif_distinta: rifDistinta.trim() || undefined,
  });
  const valide = righe.filter((r) => r.nome.trim() && r.lordo > 0);
  const calcoli = righe.map((r) => calcolaCompenso(datiDa(r)));
  const totali = valide.reduce((t, r) => {
    const c = calcolaCompenso(datiDa(r));
    return { lordo: t.lordo + r.lordo, netto: t.netto + c.netto, f24: t.f24 + c.f24 };
  }, { lordo: 0, netto: 0, f24: 0 });

  /** Aggiunge i componenti attivi degli organi sociali, con CF e IBAN dell'ultimo compenso pagato */
  async function caricaComponenti() {
    const { data, error } = await supabase.from("gal_componenti").select("nome, cognome, ruolo").eq("attivo", true).order("cognome");
    if (error) { toast.error(messaggioErrore(error, "Componenti non caricati")); return; }
    const presenti = new Set(righe.map((r) => r.nome.trim().toLowerCase()));
    const nuove: Riga[] = [];
    for (const c of (data ?? []) as { nome: string | null; cognome: string | null; ruolo: string | null }[]) {
      const nome = [c.cognome, c.nome].filter(Boolean).join(" ").trim();
      if (!nome || presenti.has(nome.toLowerCase())) continue;
      const prec = await ultimoPercettore(nome);
      nuove.push({ ...rigaVuota(), nome, cf: prec?.cf ?? "", iban: prec?.iban ?? "" });
    }
    if (!nuove.length) { toast.info("Nessun nuovo componente attivo da aggiungere"); return; }
    setRighe((rr) => [...rr.filter((r) => r.nome.trim() || r.lordo), ...nuove]);
    toast.success(`${nuove.length} componenti aggiunti: indica gli importi lordi`);
  }

  /** Quando si scrive un nome, si recuperano CF e IBAN dell'ultimo compenso (se mancano) */
  async function completaDaStorico(r: Riga) {
    if (!r.nome.trim() || (r.cf && r.iban)) return;
    const prec = await ultimoPercettore(r.nome);
    if (prec) setRiga(r.chiave, { cf: r.cf || prec.cf || "", iban: r.iban || prec.iban || "" });
  }

  function schedaConComuni(s: SchedaMandato): SchedaMandato {
    return uniscinote(applicaImpostazioni({
      ...s, delibera_ammissione: delAmmissione.trim() || undefined, delibera_autorizzazione: delAutorizzazione.trim() || undefined,
    }, imp), dataOrdine);
  }

  async function inserisci(s: SchedaMandato, collegatoA: string | null): Promise<Mandato> {
    const { data, error } = await supabase.from("gal_mandati").insert({
      anno: Number(dataOrdine.slice(0, 4)), data_ordine: dataOrdine, tipo_documento: s.tipo_documento,
      modalita: s.modalita === "f24" ? "f24" : "bonifico", scheda: s, netto: s.netto,
      beneficiario_nome: s.beneficiario_nome, beneficiario_iban: s.beneficiario_iban ?? null, cup: s.cup ?? null,
      mandato_collegato_id: collegatoA,
    }).select("*").single();
    if (error || !data) throw error ?? new Error("Mandato non salvato");
    return data as Mandato;
  }

  async function creaMandati() {
    if (!gal || !user) return;
    if (!periodo.trim()) { toast.error("Indica il periodo di competenza (es. ottobre 2026)"); return; }
    if (!valide.length) { toast.error("Inserisci almeno un percettore con nome e importo lordo"); return; }
    const incomplete = righe.filter((r) => (r.nome.trim() || r.lordo) && !(r.nome.trim() && r.lordo > 0));
    if (incomplete.length) { toast.error("Alcune righe hanno il nome ma non l'importo (o viceversa): completale o eliminale"); return; }

    // Niente doppi pagamenti: stesso percettore, stesso periodo
    setAvanzamento({ fatti: 0, totale: valide.length, testo: "Controllo dei compensi già emessi…" });
    const giaEmessi: string[] = [];
    for (const r of valide) {
      const gia = await compensiGiaEmessi(r.nome, periodo);
      if (gia.length) giaEmessi.push(`${r.nome} (mandato n. ${gia.map(numeroStampa).join(", ")})`);
    }
    setAvanzamento(null);
    if (giaEmessi.length) { setDoppi(giaEmessi); return; }
    await esegui();
  }

  async function esegui() {
    if (!gal || !user) return;
    setDoppi(null);
    const fatti: Mandato[] = [];
    const ko: string[] = [];
    const scadIt = dataIt(scadenza);
    for (let i = 0; i < valide.length; i++) {
      const r = valide[i];
      setAvanzamento({ fatti: i, totale: valide.length, testo: `Creazione dei mandati di ${r.nome}…` });
      try {
        const d = datiDa(r);
        const netto = schedaConComuni(schedaNettoCompenso(d));
        netto.note.push(NOTA_ALLEGATI_COMPENSO);
        const mNetto = await inserisci(netto, null);
        fatti.push(mNetto);
        if (conF24) {
          const f24 = schedaConComuni(schedaF24Compenso(d, gal.codice_fiscale ?? "", scadIt));
          fatti.push(await inserisci(f24, mNetto.id));
        }
      } catch (e) {
        ko.push(`${r.nome}: ${messaggioErrore(e, "mandato non creato")}`);
      }
    }
    setAvanzamento(null);
    setCreati(fatti);
    setErrori(ko);
    if (fatti.length) {
      await logAudit({ galId: gal.id, userId: user.id, username: user.nome_completo, azione: "CREATE", entita: "mandato", descrizione: `Compensi ${periodo}: creati ${fatti.length} mandati (${fatti.map(numeroStampa).join(", ")})` });
      toast.success(`Creati ${fatti.length} mandati in bozza`);
    }
    if (ko.length) toast.error(`${ko.length} percettori senza mandato: vedi l'elenco degli errori`);
  }

  async function scaricaZip() {
    if (!gal || !creati.length) return;
    try {
      const ente = await caricaEnte(gal, imp);
      setAvanzamento({ fatti: 0, totale: creati.length, testo: "Preparazione dei Word…" });
      const zip = await zipWord(creati, ente, (f, t) => setAvanzamento({ fatti: f, totale: t, testo: "Preparazione dei Word…" }));
      scaricaFile(zip, `Mandati_compensi_${periodo.trim().replace(/\s+/g, "_")}.zip`);
    } catch (e) {
      toast.error(messaggioErrore(e, "ZIP non generato"));
    } finally {
      setAvanzamento(null);
    }
  }

  if (!write) {
    return <div className="card p-6 text-sm text-gray-700">Solo operatori e amministratori possono creare mandati. <Link to="/mandati" className="text-primary-700 hover:underline">Torna ai mandati</Link></div>;
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start gap-3">
        <button className="btn-ghost p-1.5 mt-0.5" onClick={() => navigate("/mandati")} aria-label="Torna ai mandati" title="Torna ai mandati"><ArrowLeft size={18} aria-hidden="true" /></button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Compensi e gettoni</h1>
          <p className="text-sm text-gray-600 max-w-3xl">
            Per ogni percettore: mandato del <strong>netto</strong> e mandato <strong>F24</strong> collegato
            (INPS Gestione Separata: 1/3 a carico del percettore, 2/3 del GAL; IRPEF cod. 1001).
            Aliquota e IRPEF sono quelle della distinta del consulente paghe. I mandati nascono in bozza.
          </p>
        </div>
      </div>

      {/* Dati comuni */}
      <section className="card p-5 space-y-4" aria-labelledby="t-comuni">
        <h2 id="t-comuni" className="font-semibold text-gray-900">Dati comuni a tutti i mandati</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="c-periodo" className="label">Periodo di competenza *</label>
            <input id="c-periodo" className="input" value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="es. ottobre 2026" />
          </div>
          <div>
            <label htmlFor="c-data" className="label">Data dell'ordine *</label>
            <input id="c-data" type="date" className="input" value={dataOrdine} onChange={(e) => setDataOrdine(e.target.value || oggiISO())} />
          </div>
          <div>
            <label htmlFor="c-scad" className="label">Scadenza versamento F24</label>
            <input id="c-scad" type="date" className="input" value={scadenza} onChange={(e) => setScadenza(e.target.value)} aria-describedby="c-scad-aiuto" />
            <p id="c-scad-aiuto" className="text-xs text-gray-600 mt-1">Calcolata: 16 del mese successivo (agosto 20), spostata se festivo.</p>
          </div>
          <div>
            <label htmlFor="c-cup" className="label">CUP</label>
            <input id="c-cup" className="input" value={cup} onChange={(e) => setCup(e.target.value.toUpperCase())} />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="c-rif" className="label">Riferimento della distinta</label>
            <input id="c-rif" className="input" value={rifDistinta} onChange={(e) => setRifDistinta(e.target.value)} placeholder="es. Distinta di calcolo del 27/10/2026" />
          </div>
          <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="c-del1" className="label">Delibera CdA di ammissione della spesa</label>
              <input id="c-del1" className="input" list="c-delibere" value={delAmmissione} onChange={(e) => setDelAmmissione(e.target.value)} />
            </div>
            <div>
              <label htmlFor="c-del2" className="label">Delibera CdA di autorizzazione al pagamento</label>
              <input id="c-del2" className="input" list="c-delibere" value={delAutorizzazione} onChange={(e) => setDelAutorizzazione(e.target.value)} />
            </div>
            <datalist id="c-delibere">{delibere.map((d) => <option key={d} value={d} />)}</datalist>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" className="h-4 w-4" checked={conF24} onChange={(e) => setConF24(e.target.checked)} />
          Crea anche il mandato F24 collegato per ogni percettore
        </label>
      </section>

      {/* Percettori */}
      <section className="card p-5 space-y-3" aria-labelledby="t-percettori">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 id="t-percettori" className="font-semibold text-gray-900">Percettori</h2>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-secondary text-sm" onClick={caricaComponenti}><Users size={15} aria-hidden="true" /> Aggiungi componenti degli organi</button>
            <button className="btn-secondary text-sm" onClick={() => setRighe([...righe, rigaVuota(righe[righe.length - 1]?.ruolo)])}><Plus size={15} aria-hidden="true" /> Aggiungi percettore</button>
          </div>
        </div>
        <datalist id="c-ruoli">{RUOLI.map((r) => <option key={r} value={r} />)}</datalist>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <caption className="sr-only">Percettori e calcolo dei compensi</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="table-header text-left">Cognome e nome *</th>
                <th scope="col" className="table-header text-left">Codice fiscale</th>
                <th scope="col" className="table-header text-left">Causale del compenso</th>
                <th scope="col" className="table-header text-right w-28">Lordo € *</th>
                <th scope="col" className="table-header text-right w-20">Aliquota GS %</th>
                <th scope="col" className="table-header text-right w-24">IRPEF €</th>
                <th scope="col" className="table-header text-left">IBAN</th>
                <th scope="col" className="table-header text-right">Netto</th>
                <th scope="col" className="table-header text-right">F24</th>
                <th scope="col" className="table-header"><span className="sr-only">Azioni</span></th>
              </tr>
            </thead>
            <tbody>
              {righe.map((r, i) => {
                const c = calcoli[i];
                const n = i + 1;
                const ibanOk = !r.iban || ibanValido(r.iban);
                return (
                  <tr key={r.chiave} className="border-b border-gray-100 align-top">
                    <td className="py-1 pr-1"><input className="input" aria-label={`Cognome e nome percettore ${n}`} value={r.nome} onChange={(e) => setRiga(r.chiave, { nome: e.target.value })} onBlur={() => completaDaStorico(r)} /></td>
                    <td className="py-1 pr-1"><input className="input font-mono text-xs" aria-label={`Codice fiscale percettore ${n}`} value={r.cf} onChange={(e) => setRiga(r.chiave, { cf: e.target.value.toUpperCase() })} /></td>
                    <td className="py-1 pr-1"><input className="input" list="c-ruoli" aria-label={`Causale del compenso percettore ${n}`} value={r.ruolo} onChange={(e) => setRiga(r.chiave, { ruolo: e.target.value })} /></td>
                    <td className="py-1 pr-1"><input className="input text-right" type="number" step="0.01" min="0" aria-label={`Lordo percettore ${n}`} value={r.lordo} onChange={(e) => setRiga(r.chiave, { lordo: parseFloat(e.target.value) || 0 })} /></td>
                    <td className="py-1 pr-1"><input className="input text-right" type="number" step="0.01" min="0" max="50" aria-label={`Aliquota Gestione Separata percettore ${n}`} value={r.aliquota} onChange={(e) => setRiga(r.chiave, { aliquota: parseFloat(e.target.value) || 0 })} /></td>
                    <td className="py-1 pr-1"><input className="input text-right" type="number" step="0.01" min="0" aria-label={`IRPEF percettore ${n}`} value={r.irpef} onChange={(e) => setRiga(r.chiave, { irpef: parseFloat(e.target.value) || 0 })} /></td>
                    <td className="py-1 pr-1">
                      <input className={`input font-mono text-xs ${ibanOk ? "" : "border-red-500"}`} aria-label={`IBAN percettore ${n}`} aria-invalid={!ibanOk}
                        value={r.iban} onChange={(e) => setRiga(r.chiave, { iban: e.target.value.toUpperCase() })} />
                      {!ibanOk && <span className="text-xs text-red-700">IBAN non valido</span>}
                    </td>
                    <td className="py-2 text-right font-semibold whitespace-nowrap">{r.lordo > 0 ? formatCurrency(c.netto) : "—"}</td>
                    <td className="py-2 text-right whitespace-nowrap" title={r.lordo > 0 ? `INPS ${formatCurrency(c.inps_tot)} (causale ${c.causale_inps}) + IRPEF ${formatCurrency(r.irpef)}` : undefined}>
                      {r.lordo > 0 ? formatCurrency(c.f24) : "—"}
                    </td>
                    <td className="py-1">
                      <button className="btn-ghost p-1 text-red-600" onClick={() => setRighe(righe.length > 1 ? righe.filter((x) => x.chiave !== r.chiave) : [rigaVuota()])}
                        aria-label={`Elimina percettore ${n}`} title="Elimina riga"><Trash2 size={14} aria-hidden="true" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2" colSpan={3}>Totale ({valide.length} percettori)</td>
                <td className="py-2 text-right">{formatCurrency(totali.lordo)}</td>
                <td colSpan={3} />
                <td className="py-2 text-right">{formatCurrency(totali.netto)}</td>
                <td className="py-2 text-right">{formatCurrency(totali.f24)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs text-gray-600">
          Aliquota 24% (pensionati o iscritti ad altra cassa) → causale INPS C10; aliquota piena → CXX.
          CF e IBAN vengono ripresi dall'ultimo compenso pagato alla stessa persona.
        </p>
      </section>

      {avanzamento && (
        <div className="card p-4 space-y-2" role="status" aria-live="polite">
          <p className="text-sm text-gray-800 flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> {avanzamento.testo} ({avanzamento.fatti}/{avanzamento.totale})</p>
          <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={avanzamento.totale} aria-valuenow={avanzamento.fatti} aria-label="Avanzamento">
            <div className="h-full bg-primary-500" style={{ width: `${avanzamento.totale ? (avanzamento.fatti / avanzamento.totale) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {!creati.length ? (
        <div className="flex justify-end">
          <button className="btn-primary" onClick={creaMandati} disabled={!!avanzamento || !valide.length}>
            <CheckCircle2 size={16} aria-hidden="true" /> Crea {valide.length * (conF24 ? 2 : 1)} mandati in bozza
          </button>
        </div>
      ) : (
        <section className="card p-5 space-y-3" aria-labelledby="t-creati">
          <h2 id="t-creati" className="font-semibold text-gray-900">Mandati creati ({creati.length})</h2>
          <ul className="text-sm grid grid-cols-1 md:grid-cols-2 gap-1">
            {creati.map((m) => (
              <li key={m.id}>
                <Link to={`/mandati/${m.id}`} className="text-primary-700 hover:underline">n. {numeroStampa(m)}</Link>{" "}
                — {m.beneficiario_nome} {m.modalita === "f24" ? "(F24)" : ""} — {formatCurrency(m.netto)}
              </li>
            ))}
          </ul>
          {errori.length > 0 && (
            <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
              <p className="font-medium flex items-center gap-1"><AlertTriangle size={15} aria-hidden="true" /> Non creati:</p>
              <ul className="list-disc ml-5">{errori.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <button className="btn-primary" onClick={scaricaZip} disabled={!!avanzamento}><FileArchive size={16} aria-hidden="true" /> Scarica tutti i Word (ZIP)</button>
            <Link to="/mandati" className="btn-secondary">Vai al registro per controllarli e confermarli</Link>
            <button className="btn-ghost" onClick={() => { setCreati([]); setErrori([]); setRighe([rigaVuota()]); }}>Nuova distinta</button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={!!doppi}
        danger
        title="Possibile doppio pagamento"
        message={`Per ${periodo} esistono già mandati di compenso per: ${(doppi ?? []).join("; ")}. Crearne comunque di nuovi?`}
        confirmLabel="Crea comunque"
        onConfirm={esegui}
        onCancel={() => setDoppi(null)}
      />

    </div>
  );
}
