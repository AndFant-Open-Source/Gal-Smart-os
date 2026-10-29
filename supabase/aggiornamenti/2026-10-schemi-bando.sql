-- SPDX-License-Identifier: AGPL-3.0-or-later
-- SPDX-FileCopyrightText: 2026 Andrea Fantini
-- Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
--
-- Aggiornamento ottobre 2026 — da eseguire una volta nella SQL Editor dei GAL già installati.
-- Aggiunge la sezione "Schemi di bando" (iter Regione Lazio in 9 passaggi).
-- Si può rieseguire senza problemi.

-- Schemi di bando: iter di predisposizione, approvazione e pubblicazione concordato
-- con la Regione (flusso Regione Lazio SRG06 – Sottointervento A, 9 passaggi).
-- Il bando definitivo approvato passa in gal_bandi (bando_id).
CREATE TABLE IF NOT EXISTS gal_schemi_bando (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                 uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  intervento             text NOT NULL DEFAULT 'SRG06',
  sottointervento        text DEFAULT 'A',
  azione                 text,
  titolo                 text NOT NULL,
  descrizione            text,
  dotazione_finanziaria  numeric(14,2) DEFAULT 0,
  de_minimis             boolean NOT NULL DEFAULT false,
  stato                  text NOT NULL DEFAULT 'in_corso'
                         CHECK (stato IN ('in_corso', 'pubblicato', 'sospeso', 'annullato')),
  bando_id               uuid REFERENCES gal_bandi(id) ON DELETE SET NULL,
  note                   text,
  created_by             uuid DEFAULT auth.uid() REFERENCES gal_profili(id) ON DELETE SET NULL,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_schemi_bando_fasi (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id              uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  schema_id           uuid NOT NULL REFERENCES gal_schemi_bando(id) ON DELETE CASCADE,
  numero              integer NOT NULL,
  titolo              text NOT NULL,
  soggetto            text,
  canale              text,
  stato               text NOT NULL DEFAULT 'da_fare'
                      CHECK (stato IN ('da_fare', 'in_corso', 'completata', 'non_applicabile')),
  data_avvio          date,
  data_completamento  date,
  riferimento         text,
  note                text,
  completata_da       text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Crea lo schema con i 9 passaggi in un'unica operazione (tutto o niente).
-- SECURITY INVOKER: valgono le regole di accesso di chi la chiama.
CREATE OR REPLACE FUNCTION gal_crea_schema_bando(
  p_titolo text, p_intervento text, p_sottointervento text, p_azione text,
  p_descrizione text, p_dotazione numeric, p_de_minimis boolean
)
RETURNS uuid LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO gal_schemi_bando (titolo, intervento, sottointervento, azione, descrizione, dotazione_finanziaria, de_minimis)
  VALUES (p_titolo, coalesce(nullif(trim(p_intervento), ''), 'SRG06'), nullif(trim(p_sottointervento), ''),
          nullif(trim(p_azione), ''), nullif(trim(p_descrizione), ''), coalesce(p_dotazione, 0), coalesce(p_de_minimis, false))
  RETURNING id INTO v_id;

  INSERT INTO gal_schemi_bando_fasi (schema_id, numero, titolo, soggetto, canale, stato)
  SELECT v_id, f.numero, f.titolo, f.soggetto, f.canale,
         CASE WHEN f.numero = 9 AND NOT coalesce(p_de_minimis, false) THEN 'non_applicabile' ELSE 'da_fare' END
  FROM (VALUES
    (1, 'Predisposizione del testo del bando',            'GAL',                                'E-mail ai referenti regionali'),
    (2, 'Predisposizione della profilatura VECI',         'GAL – Direttore Tecnico',            'E-mail alla Regione per la validazione'),
    (3, 'Approvazione dello schema da parte del CdA',     'GAL – Consiglio di Amministrazione', 'PEC alla Regione (schema + verbale CdA)'),
    (4, 'Validazione dello schema',                       'Regione',                            'Atto amministrativo regionale'),
    (5, 'Approvazione definitiva del bando',              'GAL – Consiglio di Amministrazione', 'Delibera CdA'),
    (6, 'Profilazione dei parametri sul portale SIAN',    'GAL – Direttore Tecnico',            'Portale SIAN + e-mail alla Regione'),
    (7, 'Convalida sul portale SIAN',                     'Regione',                            'Portale SIAN'),
    (8, 'Pubblicazione del bando',                        'GAL – Presidente, DT e Segreteria',  'Siti internet istituzionali'),
    (9, 'Inserimento nel Registro Nazionale Aiuti (RNA)', 'GAL – Direttore Tecnico',            'E-mail alla Regione (solo de minimis)')
  ) AS f(numero, titolo, soggetto, canale);

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION gal_crea_schema_bando(text, text, text, text, text, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION gal_crea_schema_bando(text, text, text, text, text, numeric, boolean) TO authenticated;


CREATE INDEX IF NOT EXISTS idx_schemi_bando_bando ON gal_schemi_bando(bando_id);
CREATE UNIQUE INDEX IF NOT EXISTS gal_schemi_fasi_numero_unico ON gal_schemi_bando_fasi (schema_id, numero);

DROP TRIGGER IF EXISTS gal_schemi_bando_updated_at ON gal_schemi_bando;
CREATE TRIGGER gal_schemi_bando_updated_at BEFORE UPDATE ON gal_schemi_bando
  FOR EACH ROW EXECUTE FUNCTION gal_aggiorna_updated_at();
DROP TRIGGER IF EXISTS gal_schemi_bando_fasi_updated_at ON gal_schemi_bando_fasi;
CREATE TRIGGER gal_schemi_bando_fasi_updated_at BEFORE UPDATE ON gal_schemi_bando_fasi
  FOR EACH ROW EXECUTE FUNCTION gal_aggiorna_updated_at();

-- Regole di accesso (come le altre tabelle): schema = registro principale, passaggi = dettaglio
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gal_schemi_bando', 'gal_schemi_bando_fasi'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS lettura ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS inserimento ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS modifica ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS eliminazione ON %I', t);
    EXECUTE format('CREATE POLICY lettura ON %I FOR SELECT TO authenticated USING (gal_utente_attivo())', t);
    EXECUTE format('CREATE POLICY inserimento ON %I FOR INSERT TO authenticated WITH CHECK (gal_is_operatore())', t);
    EXECUTE format('CREATE POLICY modifica ON %I FOR UPDATE TO authenticated USING (gal_is_operatore()) WITH CHECK (gal_is_operatore())', t);
  END LOOP;
  CREATE POLICY eliminazione ON gal_schemi_bando FOR DELETE TO authenticated USING (gal_is_admin());
  CREATE POLICY eliminazione ON gal_schemi_bando_fasi FOR DELETE TO authenticated USING (gal_is_operatore());
END $$;

REVOKE ALL ON gal_schemi_bando, gal_schemi_bando_fasi FROM anon;
