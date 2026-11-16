// Small shared pieces of the interface.

const PATHS = {
  jobs: 'M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1m-9 0h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm-2 6h16',
  preferences: 'M4 7h10m4 0h2M4 17h4m4 0h8M14 5v4m-4 6v4',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  resumes: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  contacts: 'M16 19a4 4 0 0 0-8 0M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 4h16v16H4z',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M18 6l-2.5 2.5m-7 7L6 18',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M4 20h16',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  check: 'm5 12 5 5 9-10',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  search: 'm20 20-4.2-4.2M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
  bookmark: 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z',
  hide: 'M4 4l16 16M10.6 6.1A9.5 9.5 0 0 1 12 6c5 0 8.5 4.5 9 6-.2.6-.9 1.8-2 3M6.5 7.6C4.6 8.9 3.4 10.7 3 12c.5 1.5 4 6 9 6 1.6 0 3-.4 4.2-1.1',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  chevron: 'm6 9 6 6 6-6',
  external: 'M14 4h6v6m0-6-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  x: 'M6 6l12 12M18 6 6 18',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  email: 'M4 6h16v12H4zM4 7l8 6 8-6',
};

export function Icon({ name, className = 'size-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function PageHeader({ title, children, actions }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
        {children && <div className="mt-1.5 max-w-2xl text-sm text-muted">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

// A list typed as chips: Enter or comma adds, × or Backspace removes. Pasting "a, b, c" adds three.
export function TagInput({ id, value, onChange, placeholder }) {
  const add = (text) => {
    const items = text.split(',').map((s) => s.trim()).filter((s) => s && !value.includes(s));
    if (items.length) onChange([...value, ...items]);
  };
  return (
    <div className="input flex min-h-10 flex-wrap items-center gap-1.5 py-1.5 focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt/20">
      {value.map((item) => (
        <span key={item} className="inline-flex items-center gap-1 rounded-md bg-sunken py-0.5 pr-1 pl-2 text-sm">
          {item}
          <button type="button" className="rounded p-0.5 text-muted hover:text-ink" aria-label={`Remove ${item}`} onClick={() => onChange(value.filter((v) => v !== item))}>
            <Icon name="x" className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="min-w-24 flex-1 bg-transparent py-0.5 outline-none placeholder:text-faint"
        placeholder={value.length ? '' : placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(e.currentTarget.value);
            e.currentTarget.value = '';
          } else if (e.key === 'Backspace' && !e.currentTarget.value && value.length) onChange(value.slice(0, -1));
        }}
        // don't lose a word typed but not yet confirmed with Enter
        onBlur={(e) => {
          add(e.currentTarget.value);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function timeAgo(date) {
  const days = Math.round((new Date(date) - Date.now()) / 86_400_000);
  if (days > -1) {
    const hours = Math.round((new Date(date) - Date.now()) / 3_600_000);
    return hours > -1 ? 'just now' : rtf.format(hours, 'hour');
  }
  return days > -30 ? rtf.format(days, 'day') : new Date(date).toLocaleDateString();
}
