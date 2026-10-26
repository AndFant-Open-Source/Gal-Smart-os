<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Migrazione dei dati da GAL OS 4.0 o dalla versione locale

I dati si trasferiscono con il **backup ZIP** prodotto dalla pagina *Backup & Ripristino*, che ha
lo stesso formato in tutte le versioni (cartella `tabelle/` con un CSV per tabella, cartella
`allegati/` con i file, `metadata.json`).

## 1. Esportare dalla versione di provenienza

**GAL OS 4.0 web (multi-GAL, Supabase)** — per **ciascun GAL**:
1. accedere come amministratore e selezionare il GAL;
2. *Amministrazione → Backup & Ripristino → Esporta backup*: si scarica
   `backup_<GAL>_<data>.zip`.

**GAL Smart Local (versione installata sul PC)** — per **ciascuna installazione**:
1. aprire l'installazione del GAL;
2. *Amministrazione → Backup & Ripristino → Esporta backup*.

## 2. Importare nella nuova piattaforma del GAL

1. Completare l'installazione ([installazione.md](installazione.md)) e accedere come amministratore.
2. *Amministrazione → Backup & Ripristino → Ripristina*: scegliere lo ZIP del GAL e confermare.
3. Al termine il registro mostra, tabella per tabella, quanti record sono stati importati.

Cosa succede durante l'importazione:

| Dato | Trattamento |
|------|-------------|
| Anagrafica del GAL | aggiorna i dati del GAL di questa installazione (nome, codice fiscale, ecc.) |
| Tutte le tabelle | importate con gli stessi identificativi; ripetere l'importazione non crea duplicati |
| Righe di **altri** GAL eventualmente presenti | scartate |
| Utenti | **non** importati: in questa edizione si creano su invito (installazione, punto 4) |
| Autore delle pratiche e delle scadenze | azzerato (gli account del vecchio sistema non esistono qui) |
| Registro attività | importato con date e nomi originali, tramite una funzione riservata all'amministratore |
| Allegati | caricati nell'archivio privato con gli stessi percorsi |

## 3. Verifiche consigliate dopo l'importazione

- Confrontare il numero di record per sezione: *Esporta in Excel* produce il foglio **Indice** con
  i conteggi; fare lo stesso nella versione di provenienza.
- Aprire alcuni giustificativi e contratti e verificare che gli allegati si aprano.

### Limiti noti dei backup della versione 4.0

Il backup della versione precedente aveva due difetti, corretti in questa edizione (vedi
[analisi-sicurezza.md](analisi-sicurezza.md)):

1. la tabella dei **pagamenti delle domande di sostegno** non veniva esportata;
2. sul server Supabase, ogni tabella era esportata al massimo per **1000 righe**.

Se il GAL ha pagamenti di domande registrati o tabelle con più di 1000 righe (tipicamente il
registro attività), dopo l'importazione verificare i conteggi. Le righe mancanti si possono
recuperare con l'importazione del monitoraggio (*Bandi → Importa monitoraggio*) o reinserire; in
alternativa si può correggere la funzione di backup della versione di provenienza prima di
esportare.
