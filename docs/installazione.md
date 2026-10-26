<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Installazione per un nuovo GAL

Guida per mettere in funzione GAL OS per **un GAL**, da ripetere per ciascun ente
(Linee guida AgID su acquisizione e riuso del software, Allegato A §A.8).

## Come è organizzato

```
                 Repository pubblico GitHub (codice di GAL OS)
                                 │  fork
          ┌──────────────────────┴──────────────────────┐
   GitHub del GAL A                               GitHub del GAL B
          │                                              │
   Cloudflare Pages del GAL A                     Cloudflare Pages del GAL B
   https://gal-a.pages.dev                        https://gal-b.pages.dev
          │                                              │
   Supabase del GAL A                             Supabase del GAL B
   (database, utenti, file)                       (database, utenti, file)
```

Ogni GAL ha **i propri account** (GitHub, Cloudflare, Supabase), intestati all'ente. Il codice è lo
stesso per tutti; cambiano solo le variabili che indicano il database del GAL. I dati di un GAL non
passano mai dal server di un altro.

## Prerequisiti

| Componente | Note |
|------------|------|
| Account **GitHub** del GAL | Gratuito. Intestato al GAL (es. e-mail istituzionale), non a una persona |
| Account **Cloudflare** del GAL | Gratuito (Cloudflare Pages) |
| Account **Supabase** del GAL | Gratuito per iniziare; per l'uso in produzione vedi "Piano Supabase" più sotto |
| Node.js 20+ | Solo per chi sviluppa o vuole compilare in locale |

---

## 1. Database (Supabase del GAL)

1. Accedere a [supabase.com](https://supabase.com) con l'account del GAL e creare un **nuovo
   progetto**. Regione: **Central EU (Frankfurt)**, per la residenza dei dati nell'UE. Annotare la
   password del database in un luogo sicuro.
2. *SQL Editor → New query*: incollare **tutto** il file [`supabase/schema.sql`](../supabase/schema.sql)
   ed eseguire (**Run**). Crea tabelle, regole di sicurezza e archivio file privato.
   Lo script si può rieseguire senza perdere dati.
3. *Authentication → Sign In / Providers → Email*: **disattivare "Allow new users to sign up"**.
   Gli account si creano solo su invito.
4. *Authentication → URL Configuration* (da completare dopo il passo 3, quando si conosce l'indirizzo
   del sito):
   - **Site URL**: `https://<indirizzo-del-sito>/nuova-password`
   - **Redirect URLs**: aggiungere `https://<indirizzo-del-sito>/nuova-password`

   Così i link delle e-mail di invito e di recupero password portano alla pagina in cui si sceglie
   la password.
5. *Project Settings → API*: copiare **Project URL** e la chiave **anon public**. Servono al passo 3.
   **Non usare mai la chiave `service_role`** nell'applicazione.

## 2. Codice (GitHub del GAL)

1. Accedere a GitHub con l'account del GAL.
2. Aprire il repository pubblico di GAL OS e premere **Fork**: si crea una copia nell'account del
   GAL, che resterà collegata all'originale.
3. Per ricevere gli aggiornamenti: nella copia del GAL, **Sync fork → Update branch**. Cloudflare
   pubblica automaticamente la nuova versione.

## 3. Sito (Cloudflare Pages del GAL)

1. Accedere a [dash.cloudflare.com](https://dash.cloudflare.com) con l'account del GAL.
2. *Workers & Pages → Create → Pages → Connect to Git*: collegare l'account GitHub del GAL e
   scegliere la copia (fork) del repository.
3. Impostazioni di build:
   - *Framework preset*: `React (Vite)` (oppure `None`)
   - *Build command*: `npm run build`
   - *Build output directory*: `dist`
4. *Environment variables* (Production):

   | Variabile | Valore |
   |-----------|--------|
   | `VITE_SUPABASE_URL` | Project URL del Supabase del GAL |
   | `VITE_SUPABASE_ANON_KEY` | chiave **anon public** |
   | `VITE_NOME_ENTE` | nome del GAL, mostrato nella pagina di accesso |
   | `VITE_URL_CODICE_SORGENTE` | indirizzo del repository pubblico di GAL OS |

   Le variabili entrano nella compilazione: dopo averle cambiate serve un nuovo deploy
   (*Deployments → Retry deployment*).
5. *Save and Deploy*. L'indirizzo sarà del tipo `https://<nome>.pages.dev`; si può collegare un
   dominio del GAL in *Custom domains*.
6. Tornare su Supabase e completare il punto 1.4 (URL Configuration) con questo indirizzo.

Cloudflare applica le intestazioni di sicurezza di `public/_headers` (politica dei contenuti, niente
incorporamento in altri siti, solo HTTPS) e serve `index.html` per tutte le pagine dell'app.
La versione di Node per la compilazione è indicata in `.nvmrc`.

## 4. Primo utente (amministratore del GAL)

1. Supabase: *Authentication → Users → Invite user*, e-mail dell'amministratore del GAL.
2. Supabase: *SQL Editor*, eseguire:

   ```sql
   SELECT gal_nomina_amministratore('email@del-gal.it');
   ```

3. L'amministratore apre l'e-mail di invito, sceglie la password e accede.
4. Al primo accesso compare l'avviso **"Primo avvio"**: in *Impostazioni e dati GAL* inserire nome,
   codice fiscale, partita IVA e indirizzo del GAL (compaiono nei PDF e nella scheda mandato).

**Altre persone** (facoltativo, se il GAL non lavora con un solo utente): invito da Supabase come
al punto 1; la persona compare in *Utenti* come "da attivare": l'amministratore la attiva e
sceglie ruolo (operatore o lettore) e funzione (Segreteria, Direttore Tecnico, RAF).

## 5. Dati esistenti

Per portare i dati dalla versione multi-GAL (web) o dalla versione locale:
[migrazione-dati.md](migrazione-dati.md).

---

## Sviluppo in locale

```bash
git clone https://github.com/AndFant-Open-Source/Gal-Smart-os.git
cd Gal-Smart-os
npm install
cp .env.example .env      # su Windows: copy .env.example .env  — poi compilare
npm run dev               # http://localhost:5173
```

| Comando | Cosa fa |
|---------|---------|
| `npm run dev` | Avvia l'app in sviluppo |
| `npm run typecheck` | Controllo dei tipi TypeScript |
| `npm run test:db` | Esegue `supabase/schema.sql` su un PostgreSQL in memoria e verifica le regole di sicurezza |
| `npm run build` | Controllo dei tipi e compilazione in `dist/` |

Per provare in locale con un database di prova, creare un progetto Supabase dedicato allo sviluppo
(mai quello di un GAL in produzione) e aggiungere `http://localhost:5173/nuova-password` alle
Redirect URLs.

## Configurazione

| Variabile | Obbligatoria | Descrizione |
|-----------|:---:|-------------|
| `VITE_SUPABASE_URL` | sì | URL del progetto Supabase del GAL |
| `VITE_SUPABASE_ANON_KEY` | sì | Chiave pubblica `anon` |
| `VITE_NOME_ENTE` | sì | Nome del GAL nella pagina di accesso |
| `VITE_URL_CODICE_SORGENTE` | no | Link al codice sorgente a piè di pagina (AGPL sezione 13) |

## Aggiornamenti del database

Le nuove installazioni usano solo `supabase/schema.sql`. Quando una versione futura modifica il
database, lo script di aggiornamento sarà in `supabase/aggiornamenti/` con la data nel nome e va
eseguito una volta nella SQL Editor di ogni GAL. Rieseguire `schema.sql` è comunque sicuro.

## Piano Supabase, continuità e copie di sicurezza

- Il piano **gratuito** di Supabase mette in pausa i progetti inattivi per una settimana e non
  include copie di sicurezza ripristinabili a un punto nel tempo. Per l'uso in produzione da parte
  di un ente è consigliato il **piano Pro** (copie giornaliere automatiche), intestato al GAL.
- In ogni caso, l'amministratore scarica periodicamente da *Backup & Ripristino* il **backup ZIP**
  (dati e allegati) e lo conserva negli archivi del GAL; *Esporta in Excel* produce una copia
  leggibile di tutti i dati.
- Protezione dei dati (GDPR): il GAL indica il trattamento nel proprio registro e nomina Supabase
  (e Cloudflare per l'hosting) responsabili del trattamento, accettandone i DPA dalle rispettive
  dashboard.
