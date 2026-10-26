// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
/**
 * Gli export già presenti nelle pagine (Excel con SheetJS, PDF con jsPDF) creano
 * il file in memoria ("blob:") e lo liberano pochi secondi dopo aver avviato il
 * download. Nella finestra dell'app, se il browser chiede dove salvare o è lento,
 * il file viene liberato prima di essere scritto e il download risulta vuoto.
 *
 * Qui il rilascio dei file in memoria viene rimandato di 10 minuti: il tempo per
 * completare qualsiasi download, con un consumo di memoria trascurabile.
 */
const RITARDO_MS = 10 * 60 * 1000;
const revocaOriginale = URL.revokeObjectURL.bind(URL);

URL.revokeObjectURL = (url: string): void => {
  window.setTimeout(() => revocaOriginale(url), RITARDO_MS);
};

export {};
