// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Prova dello schema su PostgreSQL (PGlite) con simulazione di Supabase: `npm run test:db`
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const schema = fs.readFileSync(process.argv[2] ?? new URL("../supabase/schema.sql", import.meta.url), "utf8").replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/, "");
const db = new PGlite();
let fail = 0;
const ok = (l, c, x) => { if (c) console.log("  ok  ", l); else { fail++; console.log("  FAIL", l, x ?? ""); } };

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth; CREATE SCHEMA storage;
  CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint);
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA auth, storage, public TO authenticated, anon;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
`).catch((e) => { console.error(e); process.exit(1); });

// Supabase concede di base i privilegi ai ruoli API: simuliamo lo stesso
const grants = `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon;
  GRANT ALL ON storage.objects TO authenticated; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;`;

console.log("Schema");
try { await db.exec(schema); ok("prima esecuzione", true); } catch (e) { ok("prima esecuzione", false, e.message); process.exit(1); }
try { await db.exec(schema); ok("seconda esecuzione (idempotente)", true); } catch (e) { ok("seconda esecuzione", false, e.message); }
await db.exec(grants);
await db.exec("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;");

const q = async (sql, params) => (await db.query(sql, params)).rows;
const come = async (uid, fn) => {
  await db.exec(`SET test.uid = '${uid ?? ""}'; SET ROLE authenticated;`);
  try { return await fn(); } finally { await db.exec("RESET ROLE; SET test.uid = '';"); }
};
const prova = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

console.log("GAL unico");
ok("una riga in gal_gal", (await q("SELECT count(*)::int n FROM gal_gal"))[0].n === 1);
ok("seconda riga rifiutata", !!(await prova(() => db.exec("INSERT INTO gal_gal (nome) VALUES ('Altro GAL')"))));

console.log("Utenti");
const [admin] = await q("INSERT INTO auth.users (email) VALUES ('admin@gal.it') RETURNING id");
const [estraneo] = await q("INSERT INTO auth.users (email) VALUES ('sconosciuto@x.it') RETURNING id");
const [oper] = await q("INSERT INTO auth.users (email) VALUES ('oper@gal.it') RETURNING id");
ok("profilo creato disattivato", (await q("SELECT attivo, ruolo FROM gal_profili WHERE id=$1", [estraneo.id]))[0]?.attivo === false);
ok("nomina amministratore", (await q("SELECT gal_nomina_amministratore('ADMIN@gal.it') r"))[0].r.startsWith("Amministratore"));
await db.exec(`UPDATE gal_profili SET ruolo='operatore', attivo=true WHERE id='${oper.id}'`);

console.log("Valori scritti a mano nel Table Editor");
{
  const [v] = await q("INSERT INTO auth.users (email) VALUES ('vanessa@gal.it') RETURNING id");
  await db.exec(`UPDATE gal_profili SET nome_completo='Vanessa', ruolo='Operatore', funzione='Segreteria', attivo=true WHERE id='${v.id}'`);
  const [p] = await q("SELECT ruolo, funzione, email FROM gal_profili WHERE id=$1", [v.id]);
  ok("'Segreteria' e 'Operatore' convertiti", p.ruolo === "operatore" && p.funzione === "segreteria", p);
  await db.exec(`UPDATE gal_profili SET funzione='Direttore Tecnico' WHERE id='${v.id}'`);
  ok("'Direttore Tecnico' convertito", (await q("SELECT funzione FROM gal_profili WHERE id=$1", [v.id]))[0].funzione === "direttore_tecnico");
  await db.exec(`UPDATE gal_profili SET funzione='RAF', email=NULL WHERE id='${v.id}'`);
  const [p2] = await q("SELECT funzione, email FROM gal_profili WHERE id=$1", [v.id]);
  ok("'RAF' convertito ed e-mail recuperata dall'account", p2.funzione === "raf" && p2.email === "vanessa@gal.it", p2);
  ok("valore sconosciuto ancora rifiutato", !!(await prova(() => db.exec(`UPDATE gal_profili SET funzione='Cuoco' WHERE id='${v.id}'`))));
}

console.log("Regole di accesso");
await come(admin.id, () => db.exec("INSERT INTO gal_bandi (titolo) VALUES ('Bando prova')"));
ok("admin inserisce senza gal_id (predefinito)", (await q("SELECT gal_id IS NOT NULL g FROM gal_bandi"))[0].g);
ok("account non attivo non vede nulla", (await come(estraneo.id, () => q("SELECT * FROM gal_bandi"))).length === 0);
ok("account non attivo non inserisce", !!(await come(estraneo.id, () => prova(() => db.exec("INSERT INTO gal_bandi (titolo) VALUES ('x')")))));
ok("account non attivo non legge il GAL", (await come(estraneo.id, () => q("SELECT * FROM gal_gal"))).length === 0);
ok("account non attivo non si auto-attiva", !!(await come(estraneo.id, () => prova(() => db.exec(`UPDATE gal_profili SET attivo=true, ruolo='admin' WHERE id='${estraneo.id}'`)))) ||
   (await q("SELECT attivo FROM gal_profili WHERE id=$1", [estraneo.id]))[0].attivo === false);
ok("anonimo senza accesso", !!(await prova(async () => { await db.exec("SET ROLE anon"); try { await db.query("SELECT * FROM gal_bandi"); } finally { await db.exec("RESET ROLE"); } })));
ok("operatore legge", (await come(oper.id, () => q("SELECT * FROM gal_bandi"))).length === 1);
ok("operatore non elimina un bando", (await come(oper.id, () => q("DELETE FROM gal_bandi RETURNING id"))).length === 0);
{
  const [g] = await come(admin.id, () => q("INSERT INTO gal_giustificativi (numero_doc, data_doc, stato) VALUES ('5/001', '2026-02-20', 'annullata') RETURNING id"));
  await come(admin.id, () => db.exec(`INSERT INTO gal_righe_imputazione (giustificativo_id) VALUES ('${g.id}')`));
  ok("operatore non elimina un giustificativo", (await come(oper.id, () => q("DELETE FROM gal_giustificativi WHERE id=$1 RETURNING id", [g.id]))).length === 0);
  ok("admin elimina un giustificativo annullato con le sue righe", (await come(admin.id, () => q("DELETE FROM gal_giustificativi WHERE id=$1 RETURNING id", [g.id]))).length === 1
     && (await q("SELECT count(*)::int AS n FROM gal_righe_imputazione WHERE giustificativo_id=$1", [g.id]))[0].n === 0);
}
ok("operatore non si promuove admin", !!(await come(oper.id, () => prova(() => db.exec(`UPDATE gal_profili SET ruolo='admin' WHERE id='${oper.id}'`)))));
ok("operatore modifica il proprio nome", !(await come(oper.id, () => prova(() => db.exec(`UPDATE gal_profili SET nome_completo='Mario' WHERE id='${oper.id}'`)))));
ok("operatore non modifica il GAL", (await come(oper.id, () => q("UPDATE gal_gal SET nome='X' RETURNING id"))).length === 0);
ok("admin modifica il GAL", (await come(admin.id, () => q("UPDATE gal_gal SET nome='GAL Prova' RETURNING id"))).length === 1);
ok("ultimo admin non si disattiva", !!(await come(admin.id, () => prova(() => db.exec(`UPDATE gal_profili SET attivo=false WHERE id='${admin.id}'`)))));

console.log("Registro attività");
ok("evento a proprio nome", !(await come(oper.id, () => prova(() => db.exec(`INSERT INTO gal_audit (user_id, azione) VALUES ('${oper.id}', 'CREATE')`)))));
ok("evento a nome di altri rifiutato", !!(await come(oper.id, () => prova(() => db.exec(`INSERT INTO gal_audit (user_id, azione) VALUES ('${admin.id}', 'CREATE')`)))));
ok("evento non modificabile", (await come(admin.id, () => q("UPDATE gal_audit SET azione='X' RETURNING id"))).length === 0);
ok("evento non eliminabile", (await come(admin.id, () => q("DELETE FROM gal_audit RETURNING id"))).length === 0);
ok("importazione storico (admin)", (await come(admin.id, () => q("SELECT gal_importa_registro_attivita($1::jsonb) n", [JSON.stringify([{ azione: "CREATE", username: "Vecchio", created_at: "2025-01-01T10:00:00Z" }])])))[0].n === 1);
ok("importazione storico negata all'operatore", !!(await come(oper.id, () => prova(() => q("SELECT gal_importa_registro_attivita('[]'::jsonb)")))));

console.log("Scadenzario");
const scad = (extra) => `INSERT INTO gal_scadenze_pagamento (beneficiario, descrizione, data_scadenza, cup ${extra.c}) VALUES ('Rossi','Consulenza','2026-11-30','J12F23000120009' ${extra.v})`;
ok("CIG obbligatorio", !!(await come(oper.id, () => prova(() => db.exec(scad({ c: "", v: "" }))))));
ok("CIG presente accettato", !(await come(oper.id, () => prova(() => db.exec(scad({ c: ",cig", v: ",'B1234ABCD5'" }))))));
ok("CIG esente con motivo accettato", !(await come(oper.id, () => prova(() => db.exec(scad({ c: ",cig_esente,cig_motivo_esenzione", v: ",true,'F24'" }))))));
ok("CUP vuoto rifiutato", !!(await come(oper.id, () => prova(() => db.exec("INSERT INTO gal_scadenze_pagamento (beneficiario, descrizione, data_scadenza, cup, cig) VALUES ('R','D','2026-11-30','  ','B1234ABCD5')")))));
await come(oper.id, () => db.exec("UPDATE gal_scadenze_pagamento SET mandato_numero='1/2026' WHERE cig='B1234ABCD5'"));
ok("numero di mandato non duplicabile", !!(await come(oper.id, () => prova(() => db.exec("UPDATE gal_scadenze_pagamento SET mandato_numero='1/2026' WHERE cig_esente")))));

console.log("Schemi di bando");
{
  const crea = (dm) => `SELECT gal_crea_schema_bando('Schema SRG06 A1', 'SRG06', 'A', 'A1', NULL, 100000, ${dm}) AS id`;
  const [s] = await come(oper.id, () => q(crea("false")));
  const fasi = await come(oper.id, () => q("SELECT numero, stato FROM gal_schemi_bando_fasi WHERE schema_id=$1 ORDER BY numero", [s.id]));
  ok("schema creato con i 9 passaggi", fasi.length === 9 && fasi[0].numero === 1, fasi.length);
  ok("RNA non applicabile senza de minimis", fasi[8].stato === "non_applicabile", fasi[8]);
  const [s2] = await come(oper.id, () => q(crea("true")));
  ok("RNA da fare con de minimis", (await q("SELECT stato FROM gal_schemi_bando_fasi WHERE schema_id=$1 AND numero=9", [s2.id]))[0].stato === "da_fare");
  ok("passaggio duplicato rifiutato", !!(await come(oper.id, () => prova(() => db.exec(`INSERT INTO gal_schemi_bando_fasi (schema_id, numero, titolo) VALUES ('${s.id}', 3, 'Doppio')`)))));
  ok("account non attivo non crea schemi", !!(await come(estraneo.id, () => prova(() => q(crea("false"))))));
  ok("operatore non elimina uno schema", (await come(oper.id, () => q("DELETE FROM gal_schemi_bando WHERE id=$1 RETURNING id", [s2.id]))).length === 0);
  ok("admin elimina uno schema con i suoi passaggi", (await come(admin.id, () => q("DELETE FROM gal_schemi_bando WHERE id=$1 RETURNING id", [s2.id]))).length === 1
     && (await q("SELECT count(*)::int n FROM gal_schemi_bando_fasi WHERE schema_id=$1", [s2.id]))[0].n === 0);
}

console.log("Mandati di pagamento");
{
  const scheda = `'{"voci":[],"note":[]}'::jsonb`;
  const nuovo = (extra = "", valori = "") =>
    `INSERT INTO gal_mandati (data_ordine, scheda, netto, beneficiario_nome ${extra}) VALUES ('2026-10-29', ${scheda}, 100, 'Rossi' ${valori}) RETURNING id, numero, anno`;
  ok("impostazioni: una riga già pronta", (await q("SELECT count(*)::int n FROM gal_mandati_impostazioni"))[0].n === 1);
  ok("impostazioni: l'operatore non le modifica", (await come(oper.id, () => q("UPDATE gal_mandati_impostazioni SET iban_addebito='X' RETURNING id"))).length === 0);
  ok("impostazioni: l'admin le modifica", (await come(admin.id, () => q("UPDATE gal_mandati_impostazioni SET firma_destra='Il RAF (Prova)' RETURNING id"))).length === 1);
  ok("ripartenza numerazione negata all'operatore", !!(await come(oper.id, () => prova(() => q("SELECT gal_mandati_imposta_ultimo_numero(2026, 11)")))));
  ok("admin: ultimo mandato emesso a mano = 11", (await come(admin.id, () => q("SELECT gal_mandati_imposta_ultimo_numero(2026, 11) n")))[0].n === 12);
  ok("numero proposto 12", (await come(oper.id, () => q("SELECT gal_mandati_numero_proposto(2026) n")))[0].n === 12);
  const [m1] = await come(oper.id, () => q(nuovo()));
  const [m2] = await come(oper.id, () => q(nuovo()));
  ok("numerazione automatica 12/2026 e 13/2026", m1.numero === 12 && m2.numero === 13 && m1.anno === 2026, [m1.numero, m2.numero]);
  ok("numero scelto a mano già usato rifiutato", !!(await come(oper.id, () => prova(() => q(nuovo(", numero, numero_manuale", ", 13, true"))))));
  const [m3] = await come(oper.id, () => q(nuovo(", numero, numero_manuale", ", 20, true")));
  const [m4] = await come(oper.id, () => q(nuovo()));
  ok("dopo un numero a mano (20) si riparte da 21", m3.numero === 20 && m4.numero === 21, [m3.numero, m4.numero]);
  ok("nuovo anno riparte da 1", (await come(oper.id, () => q(nuovo(", anno", ", 2027"))))[0].numero === 1);
  ok("ripartenza sotto un numero già usato rifiutata", !!(await come(admin.id, () => prova(() => q("SELECT gal_mandati_imposta_ultimo_numero(2026, 5)")))));

  const [sc] = await come(oper.id, () => q("INSERT INTO gal_scadenze_pagamento (beneficiario, descrizione, data_scadenza, cup, cig) VALUES ('Bianchi','Servizio','2026-12-01','J12F23000120009','Z111111111') RETURNING id"));
  const [m5] = await come(oper.id, () => q(nuovo(", scadenza_id", `, '${sc.id}'`)));
  const scad = async () => (await q("SELECT mandato_numero, mandato_data::text d FROM gal_scadenze_pagamento WHERE id=$1", [sc.id]))[0];
  ok("numero e data riportati nello scadenzario", (await scad()).mandato_numero === `${m5.numero}/2026` && (await scad()).d === "2026-10-29", await scad());
  await come(oper.id, () => db.exec(`UPDATE gal_mandati SET stato='verificato' WHERE id='${m5.id}'`));
  ok("mandato verificato non eliminabile (nemmeno dall'admin)", !!(await come(admin.id, () => prova(() => db.exec(`DELETE FROM gal_mandati WHERE id='${m5.id}'`)))));
  await come(oper.id, () => db.exec(`UPDATE gal_mandati SET stato='annullato' WHERE id='${m5.id}'`));
  ok("annullato: tiene il numero e libera lo scadenzario", (await scad()).mandato_numero === null
     && (await q("SELECT numero FROM gal_mandati WHERE id=$1", [m5.id]))[0].numero === m5.numero);
  ok("il numero di un annullato non si riusa", (await come(oper.id, () => q(nuovo())))[0].numero === m5.numero + 1);
  await come(oper.id, () => db.exec("INSERT INTO gal_scadenze_pagamento (beneficiario, descrizione, data_scadenza, cup, cig, mandato_numero) VALUES ('Verdi','Vecchio mandato a mano','2026-09-01','J12F23000120009','Z222222222',' 40/2026')"));
  ok("numerazione: rispetta i numeri già scritti nello scadenzario", (await come(oper.id, () => q(nuovo())))[0].numero === 41);
  {
    const [netto] = await come(oper.id, () => q(nuovo(", tipo_documento", ", 'distinta_compenso'")));
    const [f24] = await come(oper.id, () => q(nuovo(", modalita, mandato_collegato_id", `, 'f24', '${netto.id}'`)));
    ok("compenso: F24 collegato al netto con il numero successivo", f24.numero === netto.numero + 1
       && (await q("SELECT mandato_collegato_id::text c FROM gal_mandati WHERE id=$1", [f24.id]))[0].c === netto.id);
    await come(admin.id, () => db.exec(`DELETE FROM gal_mandati WHERE id='${netto.id}'`));
    ok("eliminata la bozza del netto, l'F24 resta senza collegamento", (await q("SELECT mandato_collegato_id FROM gal_mandati WHERE id=$1", [f24.id]))[0].mandato_collegato_id === null);
  }
  ok("operatore non elimina una bozza", (await come(oper.id, () => q("DELETE FROM gal_mandati WHERE id=$1 RETURNING id", [m1.id]))).length === 0);
  ok("admin elimina una bozza", (await come(admin.id, () => q("DELETE FROM gal_mandati WHERE id=$1 RETURNING id", [m1.id]))).length === 1);
  ok("contatori non scrivibili direttamente", !!(await come(oper.id, () => prova(() => db.exec("UPDATE gal_mandati_contatori SET ultimo_numero=0")))) ||
     (await q("SELECT ultimo_numero FROM gal_mandati_contatori WHERE anno=2026"))[0].ultimo_numero > 0);
}

console.log("Agenda e archivio");
const [pr] = await come(oper.id, () => q("INSERT INTO gal_agenda_pratiche (titolo, responsabile, data_scadenza) VALUES ('CdA','segreteria','2026-11-10') RETURNING id, created_by"));
ok("pratica con autore automatico", pr.created_by === oper.id);
ok("check list: operatore elimina un passaggio", !(await come(oper.id, async () => {
  await db.exec(`INSERT INTO gal_agenda_checklist (pratica_id, descrizione) VALUES ('${pr.id}','Ordine del giorno')`);
  return prova(() => db.exec("DELETE FROM gal_agenda_checklist"));
})));
await come(oper.id, () => db.exec("INSERT INTO gal_fascicoli (numero_fascicolo, ragione_sociale) VALUES ('1','Azienda')"));
ok("fascicolo con numero duplicato rifiutato", !!(await come(oper.id, () => prova(() => db.exec("INSERT INTO gal_fascicoli (numero_fascicolo, ragione_sociale) VALUES ('1','Altra')")))));

console.log("Archivio file");
ok("operatore carica un file", !(await come(oper.id, () => prova(() => db.exec("INSERT INTO storage.objects (bucket_id, name) VALUES ('documenti_gal','a.pdf')")))));
ok("account non attivo non vede i file", (await come(estraneo.id, () => q("SELECT * FROM storage.objects"))).length === 0);
ok("bucket privato da 50 MB", (await q("SELECT public, file_size_limit FROM storage.buckets WHERE id='documenti_gal'"))[0].file_size_limit == 52428800);

const nTab = (await q("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'gal\\_%'"))[0].n;
const senzaRls = await q("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'gal\\_%' AND NOT rowsecurity");
ok(`RLS attiva su tutte le ${nTab} tabelle`, senzaRls.length === 0, senzaRls.map((r) => r.tablename));

console.log(fail ? `\n${fail} controlli falliti` : "\nTutti i controlli superati");
process.exit(fail ? 1 : 0);
