<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Licenza e titolarità

Licenza di GAL OS e motivazione della scelta, secondo l'art. 69 del Codice dell'Amministrazione
Digitale (D.Lgs. 82/2005, CAD) e le *Linee guida su acquisizione e riuso di software per le
pubbliche amministrazioni* di AgID (di seguito "Linee guida"). Stessa impostazione di ProtoGal.

> Documento tecnico: non sostituisce il parere di un legale.

## 1. Titolare e licenza

| | |
|---|---|
| **Titolare dei diritti** | Andrea Fantini — © 2026 |
| **Licenza del software** | GNU Affero General Public License v3 o successive (`AGPL-3.0-or-later`) con **termini aggiuntivi** ai sensi della sezione 7 — [TERMINI-AGGIUNTIVI.md](../TERMINI-AGGIUNTIVI.md) |
| **Licenza della documentazione** | Creative Commons Attribuzione 4.0 (`CC-BY-4.0`) |
| **Testi delle licenze** | `LICENSE` (AGPL, testo ufficiale non modificato) e cartella `LICENSES/` |

Il testo ufficiale della AGPL è nel file `LICENSE` **senza alcuna modifica**: lo richiedono la
licenza stessa e le Linee guida (All. A §A.4), e permette a GitHub di riconoscere la licenza.
I termini aggiuntivi stanno in un file separato e sono richiamati in testa a ogni file sorgente,
come prescrive la sezione 7 della AGPL.

## 2. Perché la AGPL-3.0

Le Linee guida (§3.5.3) indicano la EUPL-1.2 come regola generale, con un'eccezione esplicita:
**il software usato principalmente via rete (browser) va rilasciato sotto AGPL-3.0-or-later**.
GAL OS è un'applicazione web.

- Chiunque, comprese le PA e i GAL, può usarlo, studiarlo, modificarlo e ridistribuirlo
  gratuitamente, senza convenzioni (Linee guida §3.2).
- Chi lo modifica e lo rende disponibile via rete deve pubblicare le modifiche con la stessa
  licenza: i miglioramenti tornano a tutti i GAL.
- Nessun obbligo di garanzia o assistenza per il titolare (Linee guida §3.4.3).

## 3. I termini aggiuntivi

| Termine | Sezione AGPL | Effetto |
|---------|:---:|---------|
| 1. Conservazione dell'attribuzione | 7(b) | L'interfaccia mostra "GAL OS © 2026 Andrea Fantini — software libero AGPL-3.0" (o "Basato su GAL OS …" se modificato) |
| 2. Origine e versioni modificate | 7(c) | Le versioni modificate devono essere riconoscibili e non presentarsi come l'originale |
| 3. Nome e segni distintivi | 7(e) | Nessun diritto sul nome "GAL OS": le versioni modificate distribuite a terzi devono chiamarsi diversamente |

Il risultato resta una licenza approvata dall'OSI (Linee guida §3.5.2). Le condizioni non limitano
uso, studio, modifica o ridistribuzione e comportano per chi riusa un solo adempimento: mantenere
una riga a piè di pagina.

Nell'applicazione l'avviso è nel componente `src/components/InfoSoftware.tsx`, mostrato nella pagina
di accesso, a piè di ogni pagina e nella pagina *Copyright e licenza* (raggiungibile anche senza
accesso), insieme al link al codice sorgente richiesto dalla sezione 13 della AGPL.

## 4. Titolarità rispetto all'art. 69 del CAD

Il titolare indicato è una persona fisica, l'autore: software **sviluppato in autonomia** e messo a
disposizione dei GAL e delle amministrazioni come software libero.

- I GAL lo adottano come "software open source" nella valutazione comparativa (art. 68 CAD).
- Le **modifiche** che un GAL commissiona diventano di sua titolarità e vanno rilasciate con la
  stessa licenza (Linee guida §3.9.2).

> **Da verificare:** se lo sviluppo fosse stato commissionato e pagato da un GAL con un contratto,
> l'art. 69 c. 2 attribuisce i diritti all'amministrazione committente, salvo diverso accordo
> motivato. In quel caso il titolare andrebbe rivisto.

## 5. Cosa resta da completare

| File | Campo |
|------|-------|
| `README.md` | enti presso cui è in uso, manutentore, e-mail per le segnalazioni di sicurezza |
| `SECURITY.md` | e-mail per le segnalazioni di sicurezza |
| `publiccode.yml` | referente ed e-mail in `maintenance.contacts` |
| `public/.well-known/security.txt` | `Contact` e `Canonical` |

```bash
git grep -n "DA INDICARE\|example.invalid"
```

## 6. Passi per il rilascio

1. Completare i campi sopra.
2. Creare il repository **pubblico** su GitHub e caricarvi il codice.
3. Attivare le *Issues* per le segnalazioni pubbliche (All. A §A.2).
4. Registrare il software su Developers Italia tramite `publiccode.yml` (All. A §A.11).
