import { useState } from 'react';
import { Icon } from '../ui.jsx';

// A list of short texts (skills, certifications) as removable badges, with an input to add more.
// onChange(nextItems, message, undoable): the parent saves at once. "React, Node.js" adds two; duplicates are skipped.
export function BadgeList({ items, onChange, noun, placeholder, busy }) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState('');
  const known = new Set(items.map((s) => s.toLowerCase()));

  function add(e) {
    e.preventDefault();
    const fresh = [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))].filter((s) => !known.has(s.toLowerCase()));
    if (!fresh.length) return setHint(text.trim() ? 'Already in your list' : `Type a ${noun} first`);
    onChange([...items, ...fresh], fresh.length === 1 ? `Added ${fresh[0]}` : `Added ${fresh.length} ${noun}s`);
    setText('');
    setHint('');
  }

  return (
    <div className="space-y-3">
      {items.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={`Your ${noun}s`}>
          {items.map((s) => (
            <li key={s} className="inline-flex items-center gap-1 rounded-md border border-cobalt/25 bg-cobalt-soft py-1 pr-1 pl-2.5 text-sm font-medium text-cobalt">
              {s}
              <button
                type="button"
                className="grid size-5 place-items-center rounded text-cobalt/70 hover:bg-cobalt/15 hover:text-cobalt"
                onClick={() => onChange(items.filter((x) => x !== s), `Removed ${s}`, true)}
                disabled={busy}
                aria-label={`Remove ${s}`}
              >
                <Icon name="x" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">No {noun}s yet.</p>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={add}>
        <input className="input max-w-sm flex-1" value={text} placeholder={placeholder} onChange={(e) => (setText(e.target.value), setHint(''))} aria-label={`New ${noun}`} />
        <button className="btn-outline" disabled={busy}>
          <Icon name="plus" />
          Add {noun}
        </button>
      </form>
      {hint && <p className="text-sm text-marigold">{hint}</p>}
    </div>
  );
}
