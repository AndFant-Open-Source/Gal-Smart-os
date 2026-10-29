// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Andrea Fantini
// Termini aggiuntivi (AGPL-3.0, sezione 7): vedi TERMINI-AGGIUNTIVI.md
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "../../stores/auth";
import { toast } from "sonner";
import { messaggioErrore } from "../../lib/utils";
import { Paperclip, Upload, Trash2, ExternalLink, FileText } from "lucide-react";

interface Props {
  bucket: string;
  entityId: string;
  entityType: string;
  readonly?: boolean;
}

interface Attachment {
  name: string;
  url: string;
}

export default function AttachmentPanel({ bucket, entityId, entityType, readonly }: Props) {
  const user = useAuthStore((s) => s.user);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const { data, error } = await supabase.storage.from(bucket).list(`${entityType}/${entityId}`);
    if (error) { toast.error(messaggioErrore(error, "Impossibile caricare gli allegati")); return; }
    if (!data) return;
    const items = await Promise.all(
      data.map(async (f) => {
        const { data: urlData } = await supabase.storage
          .from(bucket)
          .createSignedUrl(`${entityType}/${entityId}/${f.name}`, 3600);
        return { name: f.name, url: urlData?.signedUrl ?? "" };
      })
    );
    setFiles(items);
  }

  useEffect(() => { load(); }, [entityId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const path = `${entityType}/${entityId}/${file.name}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
    setUploading(false);
    e.target.value = "";
    if (error) { toast.error(messaggioErrore(error, "Caricamento del file non riuscito")); return; }
    toast.success("Allegato caricato");
    load();
  }

  async function handleDelete(name: string) {
    const { error } = await supabase.storage.from(bucket).remove([`${entityType}/${entityId}/${name}`]);
    if (error) { toast.error(messaggioErrore(error, "Eliminazione dell'allegato non riuscita")); return; }
    toast.success("Allegato eliminato");
    load();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Paperclip size={14} /> Allegati
      </div>
      {files.length === 0 && <p className="text-xs text-gray-400">Nessun allegato</p>}
      {files.map((f) => (
        <div key={f.name} className="flex items-center gap-2 text-sm border rounded p-2 bg-gray-50">
          <FileText size={14} className="text-gray-400" />
          <span className="flex-1 truncate">{f.name}</span>
          <a href={f.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" aria-label={`Apri ${f.name} (nuova finestra)`}>
            <ExternalLink size={12} aria-hidden="true" />
          </a>
          {!readonly && user && (
            <button className="text-red-500 hover:text-red-700" onClick={() => handleDelete(f.name)} aria-label={`Elimina ${f.name}`}>
              <Trash2 size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {!readonly && user && (
        <label className="flex items-center gap-2 text-xs text-blue-600 cursor-pointer hover:underline">
          <Upload size={12} /> {uploading ? "Caricamento..." : "Carica allegato"}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      )}
    </div>
  );
}
