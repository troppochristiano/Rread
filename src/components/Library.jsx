import { useRef, useEffect, useState } from 'react';
import { getPositionForHash } from '../hooks/useLibrary';
import { importFileToText, ACCEPT_FILE_TYPES } from '../utils/fileImport';
import { splitIntoSentences } from '../utils/textSplitter';

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="2" x2="12" y2="12" />
      <line x1="12" y1="2" x2="2" y2="12" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.5 8h6l.5-8" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h2l7-7-2-2-7 7v2z" />
      <path d="M9 3l2 2" />
    </svg>
  );
}

function previewOf(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}

export default function Library({ open, onClose, onLoad, onNew, onDelete, library, t }) {
  const { items, save, rename, selectedId } = library; // save used by handleFileImport
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function handleFileImport(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    setImporting(true);
    try {
      const extracted = await importFileToText(file);
      const firstSentence = (splitIntoSentences(extracted)[0] || '').slice(0, 80);
      const id = save(extracted, firstSentence);
      if (id) {
        onLoad({ id, text: extracted });
        onClose();
      }
    } catch (err) {
      console.error("Import failed:", err);
      const detail = err?.message || String(err);
      setImportError(`${t.importError}: ${err?.name ? `${err.name} — ` : ""}${detail}`);
    } finally {
      setImporting(false);
    }
  }

  function handleDelete(id) {
    onDelete(id);
  }

  function startRename(item) {
    setEditingId(item.id);
    setEditingTitle(item.title);
  }

  function commitRename() {
    if (editingId && editingTitle.trim()) rename(editingId, editingTitle);
    setEditingId(null);
    setEditingTitle('');
  }

  return (
    <>
      {open && <div className="library-backdrop" onClick={onClose} />}
      <aside
        className={`library-panel ${open ? 'open' : ''}`}
        aria-hidden={!open}
        role="dialog"
        aria-label={t.library}
      >
        <header className="library-header">
          <span className="library-title">{t.library}</span>
          <button
            className="library-close"
            onClick={onClose}
            title={t.libraryClose}
            aria-label={t.libraryClose}
          >
            <IconClose />
          </button>
        </header>

        <div className="library-toolbar">
          <button
            className="library-save-btn"
            onClick={() => {
              const id = onNew();
              if (id) {
                setEditingId(id);
                setEditingTitle('');
              }
            }}
          >
            {t.librarySave}
          </button>
          <span className="library-toolbar-or">{t.libraryOr}</span>
          <button
            type="button"
            className="library-save-btn library-save-btn--ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title={t.importHint}
          >
            {importing ? t.importing : t.importBtn}
          </button>
          {importError && <span className="import-error">{importError}</span>}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_FILE_TYPES}
          onChange={handleFileImport}
          style={{ display: "none" }}
        />

        <div className="library-list">
          {items.length === 0 ? (
            <p className="library-empty">{t.libraryEmpty}</p>
          ) : (
            items.map((item) => {
              const pos = getPositionForHash(item.hash);
              const pct = pos?.pct ?? 0;
              const date = new Date(item.updatedAt || item.createdAt);
              const isEditing = editingId === item.id;
              const load = () => { onLoad(item); onClose(); };
              return (
                <div
                  key={item.id}
                  className={`library-item${item.id === selectedId ? ' library-item--selected' : ''}${isEditing ? '' : ' library-item--clickable'}`}
                  role={isEditing ? undefined : 'button'}
                  tabIndex={isEditing ? undefined : 0}
                  onClick={isEditing ? undefined : load}
                  onKeyDown={isEditing ? undefined : (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      load();
                    }
                  }}
                  title={isEditing ? undefined : t.libraryLoad}
                >
                  <div className="library-item-main">
                    {isEditing ? (
                      <input
                        className="library-item-title-input"
                        value={editingTitle}
                        autoFocus
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          else if (e.key === 'Escape') { setEditingId(null); setEditingTitle(''); }
                        }}
                      />
                    ) : (
                      <span className="library-item-title">
                        {item.title || t.libraryUntitled}
                      </span>
                    )}
                    <p className="library-item-preview">{previewOf(item.text)}</p>
                    <div className="library-item-meta">
                      <span>{t.libraryDate(date)}</span>
                      <span className="library-item-dot">·</span>
                      <span>
                        {pct > 0 ? t.libraryPosition(pct) : t.libraryNoPosition}
                      </span>
                    </div>
                    {pct > 0 && (
                      <div className="library-item-progress">
                        <div className="library-item-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="library-item-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="library-item-action"
                      onClick={(e) => { e.stopPropagation(); startRename(item); }}
                      title={t.libraryRename}
                      aria-label={t.libraryRename}
                    >
                      <IconEdit />
                    </button>
                    <button
                      className="library-item-action"
                      onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                      title={t.libraryDelete}
                      aria-label={t.libraryDelete}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
