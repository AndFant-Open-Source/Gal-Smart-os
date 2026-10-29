-- SPDX-License-Identifier: AGPL-3.0-or-later
-- SPDX-FileCopyrightText: 2026 Andrea Fantini
-- Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
--
-- Aggiornamento ottobre 2026 — da eseguire una volta nella SQL Editor dei GAL già installati.
-- Aggiunge il modulo "Mandati di pagamento": impostazioni, numerazione automatica, registro.
-- Si può rieseguire senza problemi.

-- ----------------------------------------------------------------------------
-- 10 bis. Mandati di pagamento (ordini di pagamento del GAL)
-- ----------------------------------------------------------------------------
-- Impostazioni di stampa del mandato (una sola riga): conto di addebito, firme, logo.
-- Nome, indirizzo, C.F. e PEC del GAL si prendono da gal_gal.
CREATE TABLE IF NOT EXISTS gal_mandati_impostazioni (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id           uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  iban_addebito    text,
  banca_tesoriere  text,
  pratica          text,
  operazione       text DEFAULT 'SRG06',
  misura           text,
  cup              text,
  firma_sinistra   text DEFAULT 'Il Presidente',
  firma_destra     text DEFAULT 'Il RAF',
  logo_path        text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gal_mandati_impostazioni_una_riga ON gal_mandati_impostazioni ((true));
INSERT INTO gal_mandati_impostazioni (gal_id)
SELECT gal_id_unico() WHERE NOT EXISTS (SELECT 1 FROM gal_mandati_impostazioni);

-- Ultimo numero usato per anno (si aggiorna da solo; si imposta a mano solo per ripartire)
CREATE TABLE IF NOT EXISTS gal_mandati_contatori (
  anno           integer PRIMARY KEY,
  gal_id         uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  ultimo_numero  integer NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gal_mandati (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gal_id                uuid NOT NULL DEFAULT gal_id_unico() REFERENCES gal_gal(id) ON DELETE CASCADE,
  anno                  integer NOT NULL,
  numero                integer NOT NULL CHECK (numero > 0),
  numero_manuale        boolean NOT NULL DEFAULT false,
  data_ordine           date NOT NULL DEFAULT CURRENT_DATE,
  stato                 text NOT NULL DEFAULT 'bozza'
                        CHECK (stato IN ('bozza', 'verificato', 'firmato', 'pagato', 'annullato')),
  tipo_documento        text NOT NULL DEFAULT 'altro',
  modalita              text NOT NULL DEFAULT 'bonifico' CHECK (modalita IN ('bonifico', 'f24')),
  scheda                jsonb NOT NULL,
  netto                 numeric(14,2) NOT NULL,
  beneficiario_nome     text NOT NULL,
  beneficiario_piva     text,
  beneficiario_iban     text,
  numero_documento      text,
  cup                   text,
  scadenza_id           uuid REFERENCES gal_scadenze_pagamento(id) ON DELETE SET NULL,
  giustificativo_id     uuid REFERENCES gal_giustificativi(id) ON DELETE SET NULL,
  mandato_collegato_id  uuid REFERENCES gal_mandati(id) ON DELETE SET NULL,
  docx_path             text,
  verificato_da         text,
  verificato_il         timestamptz,
  created_by            uuid DEFAULT auth.uid() REFERENCES gal_profili(id) ON DELETE SET NULL,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT gal_mandati_numero_unico UNIQUE (gal_id, anno, numero)
);

-- Numeri "n/aaaa" già scritti nello scadenzario pagamenti (anche prima di questo modulo)
CREATE OR REPLACE FUNCTION gal_mandati_max_scadenzario(p_anno integer)
RETURNS integer LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(max(split_part(mandato_numero, '/', 1)::integer), 0)
  FROM gal_scadenze_pagamento
  WHERE mandato_numero ~ ('^\s*[0-9]{1,9}\s*/\s*' || p_anno || '\s*$');
$$;

-- Numerazione: senza numero → il prossimo libero dell'anno; con numero scelto a mano →
-- il contatore riparte dopo il più alto usato. Il blocco sulla riga del contatore
-- impedisce che due utenti ricevano lo stesso numero. Un mandato annullato tiene il suo numero.
CREATE OR REPLACE FUNCTION gal_mandati_numerazione()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ultimo integer;
BEGIN
  NEW.anno := coalesce(NEW.anno, extract(year FROM coalesce(NEW.data_ordine, CURRENT_DATE))::integer);
  INSERT INTO gal_mandati_contatori (anno) VALUES (NEW.anno) ON CONFLICT (anno) DO NOTHING;
  SELECT ultimo_numero INTO v_ultimo FROM gal_mandati_contatori WHERE anno = NEW.anno FOR UPDATE;
  IF NEW.numero IS NULL THEN
    NEW.numero := greatest(v_ultimo, coalesce((SELECT max(numero) FROM gal_mandati WHERE anno = NEW.anno), 0),
                           gal_mandati_max_scadenzario(NEW.anno)) + 1;
    NEW.numero_manuale := false;
  END IF;
  UPDATE gal_mandati_contatori SET ultimo_numero = greatest(ultimo_numero, NEW.numero) WHERE anno = NEW.anno;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS gal_mandati_numerazione ON gal_mandati;
CREATE TRIGGER gal_mandati_numerazione
  BEFORE INSERT OR UPDATE OF numero, anno ON gal_mandati
  FOR EACH ROW EXECUTE FUNCTION gal_mandati_numerazione();

-- Un mandato già verificato non si elimina (si annulla e conserva il numero)
CREATE OR REPLACE FUNCTION gal_mandati_proteggi_eliminazione()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Il mandato n. %/% non è una bozza: va annullato, non eliminato', OLD.numero, OLD.anno;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS gal_mandati_proteggi_eliminazione ON gal_mandati;
CREATE TRIGGER gal_mandati_proteggi_eliminazione
  BEFORE DELETE ON gal_mandati
  FOR EACH ROW EXECUTE FUNCTION gal_mandati_proteggi_eliminazione();

-- Riporta numero e data del mandato sulla riga dello scadenzario pagamenti collegata
CREATE OR REPLACE FUNCTION gal_mandati_aggiorna_scadenza()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_numero text := NEW.numero || '/' || NEW.anno;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.scadenza_id IS NOT NULL
     AND (OLD.scadenza_id IS DISTINCT FROM NEW.scadenza_id OR OLD.numero <> NEW.numero
          OR OLD.anno <> NEW.anno OR NEW.stato = 'annullato') THEN
    UPDATE gal_scadenze_pagamento SET mandato_numero = NULL, mandato_data = NULL
    WHERE id = OLD.scadenza_id AND mandato_numero = OLD.numero || '/' || OLD.anno;
  END IF;
  IF NEW.scadenza_id IS NOT NULL AND NEW.stato <> 'annullato' THEN
    UPDATE gal_scadenze_pagamento SET mandato_numero = v_numero, mandato_data = NEW.data_ordine
    WHERE id = NEW.scadenza_id
      AND (mandato_numero IS DISTINCT FROM v_numero OR mandato_data IS DISTINCT FROM NEW.data_ordine);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS gal_mandati_aggiorna_scadenza ON gal_mandati;
CREATE TRIGGER gal_mandati_aggiorna_scadenza
  AFTER INSERT OR UPDATE ON gal_mandati
  FOR EACH ROW EXECUTE FUNCTION gal_mandati_aggiorna_scadenza();

-- Numero che verrebbe assegnato (solo per mostrarlo: non lo riserva)
CREATE OR REPLACE FUNCTION gal_mandati_numero_proposto(p_anno integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN gal_utente_attivo() THEN
    greatest(coalesce((SELECT ultimo_numero FROM gal_mandati_contatori WHERE anno = p_anno), 0),
             coalesce((SELECT max(numero) FROM gal_mandati WHERE anno = p_anno), 0),
             gal_mandati_max_scadenzario(p_anno)) + 1
  END;
$$;

-- Ripartenza della numerazione (es. mandati già emessi a mano nell'anno): solo amministratore
CREATE OR REPLACE FUNCTION gal_mandati_imposta_ultimo_numero(p_anno integer, p_ultimo integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max integer;
BEGIN
  IF NOT gal_is_admin() THEN
    RAISE EXCEPTION 'Solo un amministratore può impostare la numerazione dei mandati';
  END IF;
  IF p_ultimo IS NULL OR p_ultimo < 0 THEN
    RAISE EXCEPTION 'Numero non valido';
  END IF;
  SELECT coalesce(max(numero), 0) INTO v_max FROM gal_mandati WHERE anno = p_anno;
  IF p_ultimo < v_max THEN
    RAISE EXCEPTION 'Nel % è già stato registrato il mandato n. %: il numero di partenza non può essere inferiore', p_anno, v_max;
  END IF;
  INSERT INTO gal_mandati_contatori (anno, ultimo_numero) VALUES (p_anno, p_ultimo)
  ON CONFLICT (anno) DO UPDATE SET ultimo_numero = EXCLUDED.ultimo_numero;
  RETURN p_ultimo + 1;
END;
$$;
REVOKE ALL ON FUNCTION gal_mandati_numero_proposto(integer), gal_mandati_imposta_ultimo_numero(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION gal_mandati_numero_proposto(integer), gal_mandati_imposta_ultimo_numero(integer, integer) TO authenticated;

-- Impostazioni: tutti le leggono, solo l'admin le modifica. Contatori: solo lettura
-- (si scrivono attraverso la numerazione automatica e la funzione di ripartenza).
ALTER TABLE gal_mandati_impostazioni ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lettura ON gal_mandati_impostazioni;
DROP POLICY IF EXISTS modifica ON gal_mandati_impostazioni;
CREATE POLICY lettura ON gal_mandati_impostazioni FOR SELECT TO authenticated USING (gal_utente_attivo());
CREATE POLICY modifica ON gal_mandati_impostazioni FOR UPDATE TO authenticated USING (gal_is_admin()) WITH CHECK (gal_is_admin());
ALTER TABLE gal_mandati_contatori ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lettura ON gal_mandati_contatori;
CREATE POLICY lettura ON gal_mandati_contatori FOR SELECT TO authenticated USING (gal_utente_attivo());

CREATE INDEX IF NOT EXISTS idx_mandati_scadenza       ON gal_mandati(scadenza_id);
CREATE INDEX IF NOT EXISTS idx_mandati_giustificativo ON gal_mandati(giustificativo_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gal_mandati_impostazioni', 'gal_mandati_contatori', 'gal_mandati'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION gal_aggiorna_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;

-- Registro dei mandati: stesse regole degli altri registri principali
ALTER TABLE gal_mandati ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lettura ON gal_mandati;
DROP POLICY IF EXISTS inserimento ON gal_mandati;
DROP POLICY IF EXISTS modifica ON gal_mandati;
DROP POLICY IF EXISTS eliminazione ON gal_mandati;
CREATE POLICY lettura ON gal_mandati FOR SELECT TO authenticated USING (gal_utente_attivo());
CREATE POLICY inserimento ON gal_mandati FOR INSERT TO authenticated WITH CHECK (gal_is_operatore());
CREATE POLICY modifica ON gal_mandati FOR UPDATE TO authenticated USING (gal_is_operatore()) WITH CHECK (gal_is_operatore());
CREATE POLICY eliminazione ON gal_mandati FOR DELETE TO authenticated USING (gal_is_admin());

REVOKE ALL ON gal_mandati, gal_mandati_impostazioni, gal_mandati_contatori FROM anon;
