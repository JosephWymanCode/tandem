import { useEffect } from 'react';
import { useBoard } from './store';
import './UndoButtons.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/** Text fields keep the browser's own undo, so the board's shortcuts stay out of their way. */
const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** While a dialog is open, undoing something behind it would be confusing. */
const dialogOpen = () => document.querySelector('dialog[open], [role="alertdialog"]') !== null;

/** Which history step a key press asks for, if any. */
export function shortcutFor(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>) {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

/** Undo and Redo for the person's own changes to the board, with keyboard shortcuts. */
export function UndoButtons() {
  const canUndo = useBoard((state) => state.canUndo);
  const canRedo = useBoard((state) => state.canRedo);
  const undo = useBoard((state) => state.undo);
  const redo = useBoard((state) => state.redo);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = shortcutFor(event);
      if (!step || event.defaultPrevented) return;
      if (isTypingTarget(event.target) || isTypingTarget(document.activeElement) || dialogOpen()) return;
      event.preventDefault();
      if (step === 'undo') undo();
      else redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  return (
    <div className="undo-buttons" role="group" aria-label="History">
      <button
        className="button button-quiet"
        disabled={!canUndo}
        onClick={undo}
        title={`Undo your last change (${mod}Z)`}
        aria-keyshortcuts={isMac ? 'Meta+Z' : 'Control+Z'}
      >
        Undo
      </button>
      <button
        className="button button-quiet"
        disabled={!canRedo}
        onClick={redo}
        title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`}
        aria-keyshortcuts={isMac ? 'Meta+Shift+Z' : 'Control+Y Control+Shift+Z'}
      >
        Redo
      </button>
    </div>
  );
}
