import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';
import { blankOf } from './sections.js';

// Experience, education or projects as cards with Edit and Delete, plus "Add …". Add and Edit open the same form.
// onChange(nextItems, message, undoable): the parent saves at once.
export function ItemCards({ items, section, onChange, busy }) {
  const [editing, setEditing] = useState(null); // { index: number | null, item }
  const [viewing, setViewing] = useState(null); // index of the item shown in full
  const { noun } = section;

  function save(item) {
    const isNew = editing.index == null;
    onChange(isNew ? [...items, item] : items.with(editing.index, item), `${section.title(item)} ${isNew ? 'added' : 'updated'}`);
    setEditing(null);
  }
  function remove(i) {
    const name = section.title(items[i]);
    if (confirm(`Delete "${name}"?`)) onChange(items.toSpliced(i, 1), `${name} deleted`, true);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm font-semibold">No {noun} added yet</p>
          <p className="mt-1 text-sm text-muted">Add it here, or upload a resume that includes it.</p>
        </div>
      )}
      {items.map((item, i) => (
        <article key={i} className="rounded-lg border border-line bg-surface p-4 transition hover:border-cobalt/40">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-ink">{section.title(item)}</h3>
              {section.subtitle(item) && <p className="text-sm text-muted">{section.subtitle(item)}</p>}
              {section.meta(item) && <p className="mt-0.5 text-xs text-faint">{section.meta(item)}</p>}
            </div>
            <div className="flex shrink-0 gap-1">
              <IconButton icon="eye" label={`View ${section.title(item)}`} onClick={() => setViewing(i)} />
              <IconButton icon="edit" label={`Edit ${section.title(item)}`} onClick={() => setEditing({ index: i, item })} disabled={busy} />
              <IconButton icon="trash" label={`Delete ${section.title(item)}`} onClick={() => remove(i)} disabled={busy} danger />
            </div>
          </div>
          {item.tech?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tech.map((t) => (
                <span key={t} className="rounded bg-sunken px-1.5 py-0.5 text-xs font-medium text-muted">
                  {t}
                </span>
              ))}
            </div>
          )}
          {item.description && <p className="mt-2 text-sm text-muted">{item.description}</p>}
          {item.bullets?.length > 0 && <Bullets lines={item.bullets} />}
        </article>
      ))}
      <button className="btn-outline" onClick={() => setEditing({ index: null, item: blankOf(section) })} disabled={busy}>
        <Icon name="plus" />
        Add {noun}
      </button>
      {editing && <ItemModal section={section} editing={editing} onSave={save} onClose={() => setEditing(null)} />}
      {viewing != null && items[viewing] && (
        <ItemView section={section} item={items[viewing]} onClose={() => setViewing(null)} onEdit={() => (setViewing(null), setEditing({ index: viewing, item: items[viewing] }))} />
      )}
    </div>
  );
}

// Icon-only action with its name as tooltip and screen-reader label.
function IconButton({ icon, label, onClick, disabled, danger }) {
  return (
    <button
      type="button"
      className={`grid size-8 place-items-center rounded-lg text-muted transition disabled:opacity-50 ${danger ? 'hover:bg-danger-soft hover:text-danger' : 'hover:bg-sunken hover:text-cobalt'}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label.split(' ')[0]}
    >
      <Icon name={icon} />
    </button>
  );
}

const href = (link) => (/^https?:\/\//i.test(link) ? link : `https://${link}`);

// Everything about one item, read-only, in a pop-up: each field with its label; lists as bullets, tech as badges.
function ItemView({ section, item, onClose, onEdit }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const filled = section.fields.filter((f) => (Array.isArray(item[f.key]) ? item[f.key].length : item[f.key]));
  return (
    <dialog ref={ref} className="dialog w-[min(36rem,calc(100%-2rem))]" onClose={onClose} aria-labelledby="item-view-title">
      <h2 id="item-view-title" className="section-title">
        {section.title(item)}
      </h2>
      {section.subtitle(item) && <p className="section-desc">{section.subtitle(item)}</p>}
      <dl className="mt-5 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {filled.map((f) => {
          const v = item[f.key];
          return (
            <div key={f.key}>
              <dt className="text-xs font-semibold tracking-wide text-faint uppercase">{f.label}</dt>
              <dd className="mt-1 text-sm text-ink">
                {f.type === 'tags' ? (
                  <span className="flex flex-wrap gap-1.5">
                    {v.map((t) => (
                      <span key={t} className="rounded bg-sunken px-1.5 py-0.5 text-xs font-medium text-muted">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : f.type === 'lines' ? (
                  <ul className="list-disc space-y-1 pl-5 leading-relaxed marker:text-faint">
                    {v.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : f.key === 'link' ? (
                  <a href={href(v)} target="_blank" rel="noreferrer" className="text-cobalt hover:underline">
                    {v}
                  </a>
                ) : (
                  <span className="whitespace-pre-line">{v}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" className="btn-ghost" onClick={() => ref.current?.close()}>
          Close
        </button>
        <button type="button" className="btn-outline" onClick={onEdit}>
          <Icon name="edit" />
          Edit
        </button>
      </div>
    </dialog>
  );
}

function Bullets({ lines }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, 3);
  return (
    <>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink marker:text-faint">
        {shown.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      {lines.length > 3 && (
        <button className="mt-1 text-xs font-semibold text-cobalt hover:underline" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show ${lines.length - 3} more`}
        </button>
      )}
    </>
  );
}

// Lists edit as text: "lines" one per line, "tags" comma-separated.
const toText = (f, v) => (f.type === 'lines' ? (v ?? []).join('\n') : f.type === 'tags' ? (v ?? []).join(', ') : (v ?? ''));
const fromText = (f, t) =>
  f.type === 'lines' ? t.split('\n').map((s) => s.trim()).filter(Boolean) : f.type === 'tags' ? t.split(',').map((s) => s.trim()).filter(Boolean) : t.trim();

// The Add/Edit form for one item, in a native <dialog> (Esc and the backdrop close it).
function ItemModal({ section, editing, onSave, onClose }) {
  const ref = useRef(null);
  const [form, setForm] = useState(() => Object.fromEntries(section.fields.map((f) => [f.key, toText(f, editing.item[f.key])])));
  const [errors, setErrors] = useState({});
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function submit(e) {
    e.preventDefault();
    const missing = Object.fromEntries(section.fields.filter((f) => f.required && !form[f.key].trim()).map((f) => [f.key, `${f.label} is required`]));
    if (Object.keys(missing).length) return setErrors(missing);
    onSave({ ...editing.item, ...Object.fromEntries(section.fields.map((f) => [f.key, fromText(f, form[f.key])])) });
  }

  return (
    <dialog ref={ref} className="dialog w-[min(36rem,calc(100%-2rem))]" onClose={onClose} aria-labelledby="item-modal-title">
      <form onSubmit={submit} noValidate>
        <h2 id="item-modal-title" className="section-title">
          {editing.index == null ? `Add ${section.noun}` : `Edit ${section.noun}`}
        </h2>
        <p className="section-desc">Fields marked * are required. Saving updates your profile straight away.</p>
        <div className="mt-5 grid max-h-[60vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          {section.fields.map((f) => {
            const Tag = ['textarea', 'lines'].includes(f.type) ? 'textarea' : 'input';
            return (
              <label key={f.key} className={`block ${f.half ? '' : 'sm:col-span-2'}`}>
                <span className="label">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </span>
                <Tag
                  className={`input mt-1 ${errors[f.key] ? 'border-danger' : ''}`}
                  rows={f.type === 'lines' ? 5 : 3}
                  value={form[f.key]}
                  placeholder={f.placeholder}
                  aria-invalid={Boolean(errors[f.key])}
                  onChange={(e) => (setForm({ ...form, [f.key]: e.target.value }), setErrors({ ...errors, [f.key]: undefined }))}
                />
                {errors[f.key] ? <span className="mt-1 block text-xs text-danger">{errors[f.key]}</span> : f.hint && <span className="mt-1 block text-xs text-faint">{f.hint}</span>}
              </label>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" className="btn-ghost" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button className="btn">{editing.index == null ? `Add ${section.noun}` : 'Save changes'}</button>
        </div>
      </form>
    </dialog>
  );
}
