-- SPDX-License-Identifier: AGPL-3.0-or-later
-- SPDX-FileCopyrightText: 2026 Andrea Fantini
-- Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
--
-- ============================================================================
-- GAL OS — edizione per singolo GAL — schema completo del database (Supabase)
-- ============================================================================
-- Un progetto Supabase per ogni GAL: questo database contiene i dati di UN SOLO
-- ente. Nessun utente, nemmeno l'amministratore, può vedere o gestire un altro
-- GAL, perché ogni GAL ha il proprio server.
--
-- Uso: Supabase → SQL Editor → incollare ed eseguire TUTTO il file.
-- Lo script è idempotente: rieseguirlo non cancella dati.
--
-- Dopo l'esecuzione:
--   1. Authentication → Sign In / Providers: disattivare "Allow new users to sign up"
--   2. Authentication → Users → Invite user: invitare l'utente del GAL
--   3. SQL Editor:  SELECT gal_nomina_amministratore('email@del-gal.it');
-- Guida completa: docs/installazione.md
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. Funzioni di servizio
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gal_aggiorna_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Anagrafica del GAL (una sola riga)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_gal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  codice          text,
  codice_fiscale  text,
  partita_iva     text,
  regione         text,
  indirizzo       text,
  email           text,
  pec             text,
  telefono        text,
  sito_web        text,
  attivo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
-- Un database = un GAL: impossibile inserire una seconda riga
CREATE UNIQUE INDEX IF NOT EXISTS gal_gal_una_sola_riga ON gal_gal ((true));

INSERT INTO gal_gal (nome)
SELECT 'GAL da configurare'
WHERE NOT EXISTS (SELECT 1 FROM gal_gal);

-- Identificativo dell'unico GAL: valore predefinito della colonna gal_id
CREATE OR REPLACE FUNCTION gal_id_unico()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT id FROM public.gal_gal LIMIT 1; $$;

-- ----------------------------------------------------------------------------
-- 2. Profili delle persone del GAL
-- ----------------------------------------------------------------------------
-- Ruoli: admin (tutto), operatore (inserisce e modifica), lettore (consulta).
-- funzione: Segreteria / Direttore Tecnico / RAF (usata dall'Agenda).
-- Un account senza profilo attivo non vede alcun dato.
CREATE TABLE IF NOT EXISTS gal_profili (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo  text NOT NULL DEFAULT '',
  email          text,
  ruolo          text NOT NULL DEFAULT 'lettore' CHECK (ruolo IN ('admin', 'operatore', 'lettore')),
  funzione       text CHECK (funzione IN ('segreteria', 'direttore_tecnico', 'raf')),
  attivo         boolean NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- Funzioni di autorizzazione (SECURITY DEFINER: leggono i profili senza subire
-- l'RLS ed evitano ricorsioni; search_path fisso per sicurezza)
CREATE OR REPLACE FUNCTION gal_utente_attivo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.gal_profili WHERE id = auth.uid() AND attivo);
$$;

CREATE OR REPLACE FUNCTION gal_is_operatore()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.gal_profili
                 WHERE id = auth.uid() AND attivo AND ruolo IN ('admin', 'operatore'));
$$;

CREATE OR REPLACE FUNCTION gal_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.gal_profili
                 WHERE id = auth.uid() AND attivo AND ruolo = 'admin');
$$;

-- Ogni nuovo account (invitato dalla dashboard) riceve un profilo DISATTIVATO:
-- l'amministratore lo attiva e gli assegna il ruolo dall'app (Utenti).
CREATE OR REPLACE FUNCTION gal_nuovo_profilo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.gal_profili (id, nome_completo, email, ruolo, attivo)
  VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'nome_completo', NEW.email, ''), NEW.email, 'lettore', false)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS gal_on_auth_user_created ON auth.users;
CREATE TRIGGER gal_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION gal_nuovo_profilo();

-- Nomina dell'amministratore: si esegue SOLO dalla SQL Editor (ruolo postgres).
-- Non è richiamabile dall'app.
CREATE OR REPLACE FUNCTION gal_nomina_amministratore(p_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Nessun utente con e-mail %: invitarlo prima da Authentication → Users', p_email;
  END IF;
  INSERT INTO public.gal_profili (id, nome_completo, email, ruolo, attivo)
  VALUES (v_id, p_email, p_email, 'admin', true)
  ON CONFLICT (id) DO UPDATE SET ruolo = 'admin', attivo = true;
  RETURN 'Amministratore nominato: ' || p_email;
END;
$$;
REVOKE ALL ON FUNCTION gal_nomina_amministratore(text) FROM PUBLIC, anon, authenticated;

-- Deve restare sempre almeno un amministratore attivo
CREATE OR REPLACE FUNCTION gal_proteggi_ultimo_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.ruolo = 'admin' AND OLD.attivo
     AND (TG_OP = 'DELETE' OR NEW.ruolo <> 'admin' OR NOT NEW.attivo)
     AND NOT EXISTS (SELECT 1 FROM public.gal_profili
                     WHERE id <> OLD.id AND ruolo = 'admin' AND attivo) THEN
    RAISE EXCEPTION 'Deve restare almeno un amministratore attivo';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS gal_profili_ultimo_admin ON gal_profili;
CREATE TRIGGER gal_profili_ultimo_admin
  BEFORE UPDATE OR DELETE ON gal_profili
  FOR EACH ROW EXECUTE FUNCTION gal_proteggi_ultimo_admin();

-- Un utente può aggiornare solo il proprio nome: ruolo, stato e funzione li cambia l'admin.
-- Il controllo vale per le richieste che arrivano dall'app (ruoli authenticated/anon);
-- non per la SQL Editor della dashboard (es. gal_nomina_amministratore).
CREATE OR REPLACE FUNCTION gal_profili_campi_protetti()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT gal_is_admin() AND (NEW.ruolo IS DISTINCT FROM OLD.ruolo
      OR NEW.attivo IS DISTINCT FROM OLD.attivo
      OR NEW.funzione IS DISTINCT FROM OLD.funzione
      OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'Solo un amministratore può cambiare ruolo, stato o funzione';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS gal_profili_protetti ON gal_profili;
CREATE TRIGGER gal_profili_protetti
  BEFORE UPDATE ON gal_profili
  FOR EACH ROW EXECUTE FUNCTION gal_profili_campi_protetti();

-- ----------------------------------------------------------------------------
-- 3. Registro attività (storico non modificabile)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id       uuid DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  user_id      uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  username     text,
  azione       text NOT NULL,
  entita       text,
  entita_id    text,
  descrizione  text,
  created_at   timestamptz DEFAULT now()
);

-- Importazione dello storico da un backup della versione precedente (Backup & Ripristino).
-- Solo amministratore. Gli eventi mantengono data e nome di chi aveva agito; il
-- collegamento all'utente si perde perché gli account del vecchio sistema non esistono qui.
CREATE OR REPLACE FUNCTION gal_importa_registro_attivita(p_righe jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT gal_is_admin() THEN
    RAISE EXCEPTION 'Solo un amministratore può importare il registro attività';
  END IF;
  INSERT INTO public.gal_audit (id, user_id, username, azione, entita, entita_id, descrizione, created_at)
  SELECT coalesce(nullif(r->>'id', '')::uuid, gen_random_uuid()),
         NULL,
         nullif(r->>'username', ''),
         coalesce(nullif(r->>'azione', ''), 'IMPORT'),
         nullif(r->>'entita', ''),
         nullif(r->>'entita_id', ''),
         nullif(r->>'descrizione', ''),
         coalesce(nullif(r->>'created_at', '')::timestamptz, now())
  FROM jsonb_array_elements(p_righe) AS r
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION gal_importa_registro_attivita(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION gal_importa_registro_attivita(jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Bandi e domande di sostegno
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_bandi (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                 uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  numero                 text,
  tipologia_operazione   text,
  titolo                 text NOT NULL,
  descrizione            text,
  dotazione_finanziaria  numeric(14,2) DEFAULT 0,
  stato                  text DEFAULT 'bozza',
  data_apertura          date,
  data_chiusura          date,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_domande_sostegno (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                      uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  bando_id                    uuid REFERENCES gal_bandi(id) ON DELETE SET NULL,
  codice_agea_ds              text,
  denominazione               text,
  cuaa                        text,
  comune                      text,
  provincia                   text,
  stato                       text DEFAULT 'presentata',
  spesa_pubblica_ammissibile  numeric(14,2) DEFAULT 0,
  contributo_concesso         numeric(14,2) DEFAULT 0,
  posizione_graduatoria       integer,
  data_presentazione          date,
  data_concessione            date,
  note                        text,
  created_at                  timestamptz DEFAULT now(),
  updated_at                  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_pagamenti_bando (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id          uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  domanda_id      uuid REFERENCES gal_domande_sostegno(id) ON DELETE CASCADE,
  tipo            text,
  importo         numeric(14,2) DEFAULT 0,
  data_pagamento  date,
  note            text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 5. Organi sociali
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_soci (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                 uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  codice_socio           text,
  tipo_socio             text DEFAULT 'Privato',
  denominazione          text NOT NULL,
  codice_fiscale         text,
  partita_iva            text,
  comune                 text,
  provincia              text,
  indirizzo              text,
  email                  text,
  pec                    text,
  telefono               text,
  rappresentante_legale  text,
  quota_partecipazione   numeric(14,2) DEFAULT 0,
  data_adesione          date,
  data_recesso           date,
  attivo                 boolean DEFAULT true,
  note                   text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_quote_sociali (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id           uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  socio_id         uuid REFERENCES gal_soci(id) ON DELETE CASCADE,
  anno             integer,
  quota            numeric(14,2) DEFAULT 0,
  data_versamento  date,
  note             text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_organi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id      uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  nome        text,
  tipo        text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_componenti (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id             uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  organo_id          uuid REFERENCES gal_organi(id) ON DELETE SET NULL,
  nome               text,
  cognome            text,
  ruolo              text,
  email              text,
  data_nomina        date,
  data_fine_mandato  date,
  attivo             boolean DEFAULT true,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_sedute (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id             uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  organo_id          uuid REFERENCES gal_organi(id) ON DELETE SET NULL,
  numero             integer,
  data_seduta        date,
  luogo              text,
  tipo               text,
  quorum_presente    integer,
  stato              text DEFAULT 'convocata',
  verbale_url        text,
  verbale_path       text,
  verbale_nome       text,
  ordine_del_giorno  text,
  note               text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_delibere (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id         uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  seduta_id      uuid REFERENCES gal_sedute(id) ON DELETE SET NULL,
  numero         text,
  anno           integer,
  oggetto        text,
  testo          text,
  esito          text,
  data_delibera  date,
  allegato_url   text,
  note           text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 6. Rendicontazione
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_fornitori (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id          uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  denominazione   text NOT NULL,
  partita_iva     text,
  codice_fiscale  text,
  indirizzo       text,
  comune          text,
  provincia       text,
  email           text,
  pec             text,
  iban            text,
  telefono        text,
  note            text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_periodi_ses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id            uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  codice            text,
  descrizione       text,
  data_inizio       date,
  data_fine         date,
  anno_riferimento  integer,
  misura            text,
  sotto_misura      text,
  stato             text DEFAULT 'aperto',
  perc_feasr        numeric(6,2) DEFAULT 43,
  note              text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_interventi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id      uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_tipologie_spesa (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id         uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  intervento_id  uuid REFERENCES gal_interventi(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_capitoli (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id        uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  tipologia_id  uuid REFERENCES gal_tipologie_spesa(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_voci_previsione (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id            uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  periodo_id        uuid REFERENCES gal_periodi_ses(id) ON DELETE SET NULL,
  intervento        text,
  tipologia_spesa   text,
  voce              text,
  capitolo          text,
  unita_misura      text,
  quantita          numeric(14,4) DEFAULT 1,
  costo_unitario    numeric(14,2) DEFAULT 0,
  spesa_imponibile  numeric(14,2) DEFAULT 0,
  importo_iva       numeric(14,2) DEFAULT 0,
  spesa_con_iva     numeric(14,2) DEFAULT 0,
  iva_applicabile   boolean DEFAULT false,
  note              text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_procedure (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                    uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  codice                    text,
  oggetto                   text,
  tipo_procedura            text,
  importo_stimato           numeric(14,2) DEFAULT 0,
  importo_aggiudicato       numeric(14,2),
  cig                       text,
  cup                       text,
  rup_nome                  text,
  rup_email                 text,
  fornitore_aggiudicatario  text,
  stato                     text DEFAULT 'fabbisogno',
  pubblicato_anac           boolean DEFAULT false,
  data_determina            date,
  data_affidamento          date,
  data_contratto            date,
  note                      text,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_giustificativi (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                   uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  fornitore_id             uuid REFERENCES gal_fornitori(id) ON DELETE SET NULL,
  numero_doc               text NOT NULL,
  data_doc                 date NOT NULL,
  tipo_doc                 text DEFAULT 'fattura',
  fornitore_denominazione  text,
  fornitore_piva           text,
  imponibile               numeric(14,2) DEFAULT 0,
  iva                      numeric(14,2) DEFAULT 0,
  aliquota_iva             numeric(6,2) DEFAULT 22,
  totale                   numeric(14,2) DEFAULT 0,
  cig                      text,
  cup                      text,
  intervento               text,
  tipologia_spesa          text,
  capitolo                 text,
  procedura_id             uuid REFERENCES gal_procedure(id) ON DELETE SET NULL,
  stato                    text DEFAULT 'da_pagare',
  note                     text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_pagamenti_giust (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id             uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  giustificativo_id  uuid REFERENCES gal_giustificativi(id) ON DELETE CASCADE,
  data_pagamento     date,
  importo            numeric(14,2) DEFAULT 0,
  modalita           text,
  riferimento        text,
  note               text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_righe_imputazione (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  giustificativo_id     uuid REFERENCES gal_giustificativi(id) ON DELETE CASCADE,
  voce_previsione_id    uuid REFERENCES gal_voci_previsione(id) ON DELETE SET NULL,
  periodo_id            uuid REFERENCES gal_periodi_ses(id) ON DELETE SET NULL,
  misura                text,
  sotto_misura          text,
  categoria_spesa       text,
  intervento            text,
  tipologia_spesa       text,
  voce                  text,
  capitolo              text,
  imponibile_imputato   numeric(14,2) DEFAULT 0,
  iva_imputato          numeric(14,2) DEFAULT 0,
  totale_imputato       numeric(14,2) DEFAULT 0,
  imponibile_richiesto  numeric(14,2),
  iva_richiesta         numeric(14,2),
  totale_richiesto      numeric(14,2),
  eleggibile            boolean DEFAULT true,
  tipo_acconto          text,
  note                  text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_documenti_giustificativo (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id             uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  giustificativo_id  uuid REFERENCES gal_giustificativi(id) ON DELETE CASCADE,
  tipo               text,
  nome_file          text,
  storage_path       text,
  dimensione         bigint,
  note               text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 7. Procedure di acquisto e contratti
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_procedure_invitati (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id              uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  procedura_id        uuid REFERENCES gal_procedure(id) ON DELETE CASCADE,
  denominazione       text,
  partita_iva         text,
  offerta_presentata  boolean DEFAULT false,
  importo_offerta     numeric(14,2),
  note                text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_contratti (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id           uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  numero           text NOT NULL,
  oggetto          text NOT NULL,
  contraente       text NOT NULL,
  partita_iva      text,
  tipo_contratto   text,
  importo          numeric(14,2) DEFAULT 0,
  data_stipula     date,
  data_inizio      date,
  data_fine        date,
  procedura_id     uuid REFERENCES gal_procedure(id) ON DELETE SET NULL,
  intervento       text,
  tipologia_spesa  text,
  capitolo         text,
  cig              text,
  cup              text,
  documento_path   text,
  documento_nome   text,
  stato            text DEFAULT 'attivo',
  note             text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 8. Archivio: registro di catalogazione dei fascicoli
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_fascicoli (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id            uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  numero_fascicolo  text NOT NULL,
  ragione_sociale   text NOT NULL,
  indirizzo         text,
  cap               text,
  comune            text,
  provincia         text,
  codice_fiscale    text,
  partita_iva       text,
  note              text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gal_fascicoli_numero_unico ON gal_fascicoli (gal_id, numero_fascicolo);

-- ----------------------------------------------------------------------------
-- 9. Agenda scadenze
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_agenda_pratiche (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id              uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  codice              text,
  titolo              text NOT NULL,
  descrizione         text,
  categoria           text NOT NULL DEFAULT 'altro',
  responsabile        text NOT NULL CHECK (responsabile IN ('segreteria', 'direttore_tecnico', 'raf')),
  priorita            text NOT NULL DEFAULT 'media' CHECK (priorita IN ('bassa', 'media', 'alta', 'urgente')),
  stato               text NOT NULL DEFAULT 'aperta' CHECK (stato IN ('aperta', 'in_corso', 'sospesa', 'completata', 'annullata')),
  data_apertura       date NOT NULL DEFAULT CURRENT_DATE,
  data_scadenza       date NOT NULL,
  data_promemoria     date,
  data_completamento  date,
  ricorrenza          text NOT NULL DEFAULT 'nessuna' CHECK (ricorrenza IN ('nessuna', 'mensile', 'trimestrale', 'semestrale', 'annuale')),
  riferimento         text,
  note                text,
  created_by          uuid DEFAULT auth.uid() REFERENCES gal_profili(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_agenda_checklist (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id         uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  pratica_id     uuid NOT NULL REFERENCES gal_agenda_pratiche(id) ON DELETE CASCADE,
  descrizione    text NOT NULL,
  responsabile   text CHECK (responsabile IN ('segreteria', 'direttore_tecnico', 'raf')),
  data_scadenza  date,
  completata     boolean NOT NULL DEFAULT false,
  completata_il  timestamptz,
  completata_da  text,
  ordine         integer NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_agenda_note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id      uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  pratica_id  uuid NOT NULL REFERENCES gal_agenda_pratiche(id) ON DELETE CASCADE,
  testo       text NOT NULL,
  autore      text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 10. Conti, scadenzario pagamenti, incassi e movimenti di cassa
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gal_conti (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id               uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  nome                 text NOT NULL,
  banca                text,
  iban                 text,
  tipo                 text NOT NULL DEFAULT 'conto_corrente' CHECK (tipo IN ('conto_corrente', 'conto_dedicato', 'cassa', 'carta')),
  saldo_iniziale       numeric(14,2) NOT NULL DEFAULT 0,
  data_saldo_iniziale  date NOT NULL DEFAULT CURRENT_DATE,
  attivo               boolean NOT NULL DEFAULT true,
  note                 text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_scadenze_pagamento (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                   uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  tipo                     text NOT NULL DEFAULT 'fattura'
                           CHECK (tipo IN ('fattura', 'parcella', 'f24', 'stipendio', 'utenza', 'canone', 'rimborso', 'altro')),
  fornitore_id             uuid REFERENCES gal_fornitori(id) ON DELETE SET NULL,
  beneficiario             text NOT NULL,
  beneficiario_piva        text,
  beneficiario_cf          text,
  beneficiario_iban        text,
  descrizione              text NOT NULL,
  numero_documento         text,
  data_documento           date,
  imponibile               numeric(14,2) NOT NULL DEFAULT 0,
  iva                      numeric(14,2) NOT NULL DEFAULT 0,
  split_payment            boolean NOT NULL DEFAULT false,
  ritenuta                 numeric(14,2) NOT NULL DEFAULT 0,
  ritenuta_codice_tributo  text,
  totale_documento         numeric(14,2) NOT NULL DEFAULT 0,
  importo_da_pagare        numeric(14,2) NOT NULL DEFAULT 0,
  cup                      text NOT NULL,
  cup_in_fattura           boolean NOT NULL DEFAULT false,
  cig                      text,
  cig_esente               boolean NOT NULL DEFAULT false,
  cig_motivo_esenzione     text,
  cig_in_fattura           boolean NOT NULL DEFAULT false,
  verifica_note            text,
  intervento               text,
  capitolo                 text,
  giustificativo_id        uuid REFERENCES gal_giustificativi(id) ON DELETE SET NULL,
  data_scadenza            date NOT NULL,
  stato                    text NOT NULL DEFAULT 'da_pagare'
                           CHECK (stato IN ('da_pagare', 'in_pagamento', 'pagata', 'annullata')),
  data_pagamento           date,
  conto_id                 uuid REFERENCES gal_conti(id) ON DELETE SET NULL,
  modalita_pagamento       text DEFAULT 'bonifico'
                           CHECK (modalita_pagamento IN ('bonifico', 'f24', 'rid', 'carta', 'contanti', 'altro')),
  cro_trn                  text,
  importo_pagato           numeric(14,2),
  mandato_numero           text,
  mandato_data             date,
  fattura_path             text,
  fattura_nome             text,
  bonifico_path            text,
  bonifico_nome            text,
  scadenza_origine_id      uuid REFERENCES gal_scadenze_pagamento(id) ON DELETE SET NULL,
  note                     text,
  created_by               uuid DEFAULT auth.uid() REFERENCES gal_profili(id) ON DELETE SET NULL,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  -- CUP sempre obbligatorio; CIG obbligatorio salvo esclusione motivata
  CONSTRAINT scadenze_cup_valorizzato CHECK (length(trim(cup)) > 0),
  CONSTRAINT scadenze_cig_o_motivo CHECK (
    cig_esente AND length(coalesce(trim(cig_motivo_esenzione), '')) > 0
    OR NOT cig_esente AND length(coalesce(trim(cig), '')) > 0
  )
);
-- Lo stesso numero di mandato non può essere usato due volte
CREATE UNIQUE INDEX IF NOT EXISTS gal_scadenze_mandato_unico
  ON gal_scadenze_pagamento (mandato_numero) WHERE mandato_numero IS NOT NULL;

CREATE TABLE IF NOT EXISTS gal_movimenti_cassa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id          uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('entrata', 'uscita')),
  categoria       text NOT NULL DEFAULT 'altro',
  descrizione     text NOT NULL,
  controparte     text,
  importo         numeric(14,2) NOT NULL CHECK (importo >= 0),
  data_prevista   date NOT NULL,
  data_effettiva  date,
  stato           text NOT NULL DEFAULT 'previsto' CHECK (stato IN ('previsto', 'realizzato', 'annullato')),
  conto_id        uuid REFERENCES gal_conti(id) ON DELETE SET NULL,
  riferimento     text,
  note            text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 11. Trigger updated_at, indici
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'updated_at' AND table_name LIKE 'gal\_%'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION gal_aggiorna_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_domande_bando          ON gal_domande_sostegno(bando_id);
CREATE INDEX IF NOT EXISTS idx_pag_bando_domanda      ON gal_pagamenti_bando(domanda_id);
CREATE INDEX IF NOT EXISTS idx_quote_socio            ON gal_quote_sociali(socio_id);
CREATE INDEX IF NOT EXISTS idx_delibere_seduta        ON gal_delibere(seduta_id);
CREATE INDEX IF NOT EXISTS idx_giust_fornitore        ON gal_giustificativi(fornitore_id);
CREATE INDEX IF NOT EXISTS idx_pag_giust              ON gal_pagamenti_giust(giustificativo_id);
CREATE INDEX IF NOT EXISTS idx_righe_giust            ON gal_righe_imputazione(giustificativo_id);
CREATE INDEX IF NOT EXISTS idx_righe_periodo          ON gal_righe_imputazione(periodo_id);
CREATE INDEX IF NOT EXISTS idx_doc_giust              ON gal_documenti_giustificativo(giustificativo_id);
CREATE INDEX IF NOT EXISTS idx_invitati_proc          ON gal_procedure_invitati(procedura_id);
CREATE INDEX IF NOT EXISTS idx_audit_data             ON gal_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agenda_scadenza        ON gal_agenda_pratiche(data_scadenza);
CREATE INDEX IF NOT EXISTS idx_agenda_checklist       ON gal_agenda_checklist(pratica_id);
CREATE INDEX IF NOT EXISTS idx_agenda_note            ON gal_agenda_note(pratica_id);
CREATE INDEX IF NOT EXISTS idx_scadenze_data          ON gal_scadenze_pagamento(data_scadenza);
CREATE INDEX IF NOT EXISTS idx_scadenze_origine       ON gal_scadenze_pagamento(scadenza_origine_id);

-- ----------------------------------------------------------------------------
-- 12. Row Level Security
-- ----------------------------------------------------------------------------
-- Lettura: solo persone con profilo ATTIVO (un account registrato da solo non vede nulla).
-- Inserimento e modifica: admin e operatore.
-- Eliminazione: admin per i registri principali, admin e operatore per i dettagli.
DO $$
DECLARE
  t text;
  principali text[] := ARRAY[
    'gal_bandi', 'gal_domande_sostegno', 'gal_soci', 'gal_organi', 'gal_sedute', 'gal_delibere',
    'gal_fornitori', 'gal_periodi_ses', 'gal_interventi', 'gal_tipologie_spesa', 'gal_capitoli',
    'gal_voci_previsione', 'gal_giustificativi', 'gal_procedure', 'gal_contratti', 'gal_fascicoli',
    'gal_agenda_pratiche', 'gal_conti', 'gal_scadenze_pagamento', 'gal_movimenti_cassa'];
  dettagli text[] := ARRAY[
    'gal_pagamenti_bando', 'gal_quote_sociali', 'gal_componenti', 'gal_pagamenti_giust',
    'gal_righe_imputazione', 'gal_documenti_giustificativo', 'gal_procedure_invitati',
    'gal_agenda_checklist', 'gal_agenda_note'];
BEGIN
  FOREACH t IN ARRAY principali || dettagli LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS lettura ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS inserimento ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS modifica ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS eliminazione ON %I', t);
    EXECUTE format('CREATE POLICY lettura ON %I FOR SELECT TO authenticated USING (gal_utente_attivo())', t);
    EXECUTE format('CREATE POLICY inserimento ON %I FOR INSERT TO authenticated WITH CHECK (gal_is_operatore())', t);
    EXECUTE format('CREATE POLICY modifica ON %I FOR UPDATE TO authenticated USING (gal_is_operatore()) WITH CHECK (gal_is_operatore())', t);
    IF t = ANY (principali) THEN
      EXECUTE format('CREATE POLICY eliminazione ON %I FOR DELETE TO authenticated USING (gal_is_admin())', t);
    ELSE
      EXECUTE format('CREATE POLICY eliminazione ON %I FOR DELETE TO authenticated USING (gal_is_operatore())', t);
    END IF;
  END LOOP;
END $$;

-- Anagrafica del GAL: tutti la leggono, solo l'admin la modifica; non si crea né si elimina
ALTER TABLE gal_gal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lettura ON gal_gal;
DROP POLICY IF EXISTS modifica ON gal_gal;
CREATE POLICY lettura ON gal_gal FOR SELECT TO authenticated USING (gal_utente_attivo());
CREATE POLICY modifica ON gal_gal FOR UPDATE TO authenticated USING (gal_is_admin()) WITH CHECK (gal_is_admin());

-- Profili: ognuno vede il proprio; i colleghi attivi si vedono tra loro.
-- L'admin modifica tutti; ognuno modifica il proprio nome (campi protetti dal trigger).
ALTER TABLE gal_profili ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lettura ON gal_profili;
DROP POLICY IF EXISTS modifica ON gal_profili;
DROP POLICY IF EXISTS eliminazione ON gal_profili;
CREATE POLICY lettura ON gal_profili FOR SELECT TO authenticated USING (id = auth.uid() OR gal_utente_attivo());
CREATE POLICY modifica ON gal_profili FOR UPDATE TO authenticated
  USING (gal_is_admin() OR (id = auth.uid() AND gal_utente_attivo()))
  WITH CHECK (gal_is_admin() OR (id = auth.uid() AND gal_utente_attivo()));
CREATE POLICY eliminazione ON gal_profili FOR DELETE TO authenticated USING (gal_is_admin());

-- Registro attività: si legge e si aggiunge, non si modifica né si elimina.
-- Ogni evento è registrato a nome di chi lo crea.
ALTER TABLE gal_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lettura ON gal_audit;
DROP POLICY IF EXISTS inserimento ON gal_audit;
CREATE POLICY lettura ON gal_audit FOR SELECT TO authenticated USING (gal_utente_attivo());
CREATE POLICY inserimento ON gal_audit FOR INSERT TO authenticated
  WITH CHECK (gal_utente_attivo() AND user_id = auth.uid());

-- Difesa in profondità: il ruolo anonimo non accede mai alle tabelle
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON FUNCTION gal_utente_attivo(), gal_is_operatore(), gal_is_admin() FROM anon;

-- ----------------------------------------------------------------------------
-- 13. Archivio file privato (fatture, contabili, verbali, contratti, allegati)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('documenti_gal', 'documenti_gal', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

DROP POLICY IF EXISTS "documenti_gal_lettura" ON storage.objects;
DROP POLICY IF EXISTS "documenti_gal_caricamento" ON storage.objects;
DROP POLICY IF EXISTS "documenti_gal_modifica" ON storage.objects;
DROP POLICY IF EXISTS "documenti_gal_eliminazione" ON storage.objects;
CREATE POLICY "documenti_gal_lettura" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documenti_gal' AND public.gal_utente_attivo());
CREATE POLICY "documenti_gal_caricamento" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documenti_gal' AND public.gal_is_operatore());
CREATE POLICY "documenti_gal_modifica" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documenti_gal' AND public.gal_is_operatore())
  WITH CHECK (bucket_id = 'documenti_gal' AND public.gal_is_operatore());
CREATE POLICY "documenti_gal_eliminazione" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documenti_gal' AND public.gal_is_operatore());

-- Fine dello schema
