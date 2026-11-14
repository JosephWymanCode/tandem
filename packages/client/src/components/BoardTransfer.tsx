import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { IMPORT_MAX_BYTES, IMPORT_MESSAGES } from '@tandem/shared';
import { api } from '../api';
import './BoardTransfer.css';

/**
 * Exports are pretty-printed, so a file on disk can be a few times larger than
 * the compact body that is uploaded. Files beyond this are not worth reading.
 */
const MAX_FILE_BYTES = IMPORT_MAX_BYTES * 4;

/** Download links for one board, as a JSON backup or a CSV for spreadsheets. */
export function ExportBoard({ boardId, title }: { boardId: string; title: string }) {
  return (
    <span className="board-export" role="group" aria-label={`Export ${title}`}>
      <span className="board-export-label">Export</span>
      {/* The group carries the board title, so the link names stay short and do not compete with the board link. */}
      <a className="button button-quiet" href={api.exportUrl(boardId, 'json')} download>
        JSON
      </a>
      <a className="button button-quiet" href={api.exportUrl(boardId, 'csv')} download>
        CSV
      </a>
    </span>
  );
}

/** Creates a new board from a JSON file that Tandem exported earlier. */
export function ImportBoard() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear the picker so choosing the same file again still triggers a change.
    event.target.value = '';
    if (!file) return;
    setError(null);
    if (file.size > MAX_FILE_BYTES) {
      setError(IMPORT_MESSAGES.tooLarge);
      return;
    }
    setBusy(true);
    try {
      let document: unknown;
      try {
        document = JSON.parse(await file.text());
      } catch {
        setError(IMPORT_MESSAGES.notAnExport);
        return;
      }
      // Measure what is actually uploaded, the same way the server does.
      if (new Blob([JSON.stringify(document)]).size > IMPORT_MAX_BYTES) {
        setError(IMPORT_MESSAGES.tooLarge);
        return;
      }
      const { boardId } = await api.importBoard(document);
      navigate(`/b/${boardId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import the board.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="board-import">
      <div className="board-import-row">
        <button type="button" className="button button-dark" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Importing…' : 'Import a board'}
        </button>
        <span className="board-import-hint">From a JSON file exported from Tandem</span>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          aria-label="Board file to import"
          className="board-import-input"
          onChange={(event) => void importFile(event)}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
