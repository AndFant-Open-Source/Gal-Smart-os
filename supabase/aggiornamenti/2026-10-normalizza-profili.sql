-- SPDX-License-Identifier: AGPL-3.0-or-later
-- SPDX-FileCopyrightText: 2026 Andrea Fantini
-- Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
--
-- Aggiornamento ottobre 2026 — da eseguire una volta nella SQL Editor dei GAL già installati.
-- Converte i valori scritti a mano nel Table Editor ("Segreteria", "Operatore", "RAF"…)
-- nei codici interni, invece di rifiutarli con l'errore gal_profili_funzione_check.
-- Si può rieseguire senza problemi.

-- Valori scritti a mano nel Table Editor di Supabase: "Segreteria", "Direttore Tecnico",
-- "RAF", "Operatore"… vengono convertiti nei codici interni; e-mail presa dall'account.
-- (I trigger BEFORE scattano prima dei controlli CHECK; questo scatta per primo.)
CREATE OR REPLACE FUNCTION gal_profili_normalizza()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.ruolo := lower(trim(NEW.ruolo));
  IF NEW.ruolo IN ('amministratore', 'administrator') THEN NEW.ruolo := 'admin'; END IF;
  IF NEW.funzione IS NOT NULL THEN
    NEW.funzione := regexp_replace(lower(trim(NEW.funzione)), '[^a-z]+', '_', 'g');
    NEW.funzione := CASE
      WHEN NEW.funzione = '' THEN NULL
      WHEN NEW.funzione LIKE 'direttore%' OR NEW.funzione = 'dt' THEN 'direttore_tecnico'
      WHEN NEW.funzione LIKE 'segreteria%' OR NEW.funzione = 'segretaria' THEN 'segreteria'
      WHEN NEW.funzione LIKE 'raf%' OR NEW.funzione LIKE 'responsabile_amm%' THEN 'raf'
      ELSE NEW.funzione
    END;
  END IF;
  IF NEW.email IS NULL OR trim(NEW.email) = '' THEN
    SELECT u.email INTO NEW.email FROM auth.users u WHERE u.id = NEW.id;
  END IF;
  NEW.nome_completo := coalesce(nullif(trim(NEW.nome_completo), ''), NEW.email, '');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS gal_profili_normalizza ON gal_profili;
CREATE TRIGGER gal_profili_normalizza
  BEFORE INSERT OR UPDATE ON gal_profili
  FOR EACH ROW EXECUTE FUNCTION gal_profili_normalizza();
