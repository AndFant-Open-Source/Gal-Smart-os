<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Segnalazione di problemi di sicurezza

**Non aprire issue pubbliche per segnalare vulnerabilità.**

Le segnalazioni di sicurezza vanno inviate in forma riservata all'indirizzo:

> **[E-MAIL SICUREZZA DA INDICARE]**

Indicare, se possibile:

- versione del software (visibile a piè di pagina, es. `GAL OS v5.0.0`);
- descrizione del problema e dei passi per riprodurlo;
- impatto stimato (es. accesso ai dati da parte di un utente non abilitato, modifica non
  autorizzata di un pagamento o del registro attività).

Il manutentore conferma la ricezione entro 2 giorni lavorativi. I dettagli della vulnerabilità
restano riservati fino al rilascio della correzione e vengono pubblicati successivamente, come
previsto dalle Linee guida AgID su acquisizione e riuso del software (Allegato B §B.2.3).

## Misure di sicurezza adottate

- **Un progetto Supabase separato per ogni GAL**: i dati di enti diversi non stanno mai nello stesso
  database; il database accetta una sola anagrafica di GAL.
- **Row Level Security su tutte le tabelle**: vede i dati solo chi ha un profilo **attivo**. Un
  account registrato da solo, o invitato e non ancora attivato, non vede nulla. Il ruolo anonimo
  non ha alcun accesso alle tabelle.
- **Ruoli applicati dal database**: lettore (consulta), operatore (inserisce e modifica),
  amministratore (elimina, gestisce utenti e dati del GAL). Un utente non può cambiarsi ruolo o
  stato; deve restare sempre almeno un amministratore attivo.
- **Registro attività non modificabile**: ogni evento è registrato a nome di chi lo crea e non
  può essere modificato né eliminato dall'applicazione.
- **Regole di contenuto nel database**: CUP sempre obbligatorio e CIG obbligatorio salvo
  esclusione motivata sui pagamenti; numeri di mandato e di fascicolo non duplicabili.
- **Allegati in un archivio privato** (limite 50 MB per file), accessibili solo tramite URL firmati
  temporanei e solo agli utenti attivi.
- **Nessuna credenziale nel repository**: le chiavi stanno nel file `.env` (escluso da git) o nelle
  variabili di Cloudflare Pages. Nel browser si usa solo la chiave pubblica `anon`; la chiave
  `service_role` non deve mai essere inserita nell'applicazione.
- **Intestazioni di sicurezza** (`public/_headers`): politica dei contenuti che consente solo il sito
  stesso e Supabase, divieto di incorporamento in altri siti, solo HTTPS. Nessuna risorsa caricata
  da server esterni (niente caratteri o script di terze parti).
- **Prova automatica** dello schema e delle regole (`npm run test:db`), eseguita a ogni modifica
  dalla Continuous Integration.
