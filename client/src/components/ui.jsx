import { useState, useSyncExternalStore } from 'react';

// Small shared pieces of the interface.

const PATHS = {
  jobs: 'M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1m-9 0h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm-2 6h16',
  preferences: 'M4 7h10m4 0h2M4 17h4m4 0h8M14 5v4m-4 6v4',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  resumes: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  contacts: 'M16 19a4 4 0 0 0-8 0M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 4h16v16H4z',
  sparkle: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M18 6l-2.5 2.5m-7 7L6 18',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4zM13.5 6.5l4 4',
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
  tracker: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v.01M11 12h1v5h1',
  alert: 'M12 9v4m0 4v.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  board: 'M4 4h6v16H4zM14 4h6v10h-6z',
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
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {children && <div className="mt-2 max-w-2xl text-sm text-muted">{children}</div>}
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

// Toasts: toast('Saved') from anywhere; <Toaster /> in App shows them. Errors stay longer than successes.
let toasts = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
export function toast(message, tone = 'success', action) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, message, tone, action }];
  emit();
  setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4500);
}
const dismiss = (id) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};
const TOAST_TONE = {
  success: ['check', 'border-ok/40', 'text-ok'],
  error: ['alert', 'border-danger/40', 'text-danger'],
  warning: ['alert', 'border-marigold/40', 'text-marigold'],
  info: ['info', 'border-cobalt/40', 'text-cobalt'],
};
export function Toaster() {
  const list = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => toasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100%-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {list.map((t) => {
        const [icon, border, color] = TOAST_TONE[t.tone] ?? TOAST_TONE.info;
        return (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface px-4 py-3 text-sm shadow-lg [animation:toast-in_200ms_ease-out] ${border}`}>
            <span className={color}>
              <Icon name={icon} className="mt-0.5 size-4" />
            </span>
            <p className="flex-1 text-ink">{t.message}</p>
            {t.action && (
              <button className="font-semibold text-cobalt hover:underline" onClick={() => (t.action.run(), dismiss(t.id))}>
                {t.action.label}
              </button>
            )}
            <button className="text-faint hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <Icon name="x" className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// A message inside the page. tone: info | success | warning | error. Say what happened, then give one action.
const NOTICE_TONE = {
  info: ['info', 'border-cobalt/30 bg-cobalt-soft', 'text-cobalt'],
  success: ['check', 'border-ok/30 bg-ok-soft', 'text-ok'],
  warning: ['alert', 'border-marigold/30 bg-marigold-soft', 'text-marigold'],
  error: ['alert', 'border-danger/30 bg-danger-soft', 'text-danger'],
};
// onClose: shows an x to dismiss it (for one-off results like "3 held back").
export function Notice({ tone = 'info', children, action, onClose, className = 'mb-3' }) {
  const [icon, box, color] = NOTICE_TONE[tone];
  return (
    <div className={`fade-in flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed text-ink ${box} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={color}>
        <Icon name={icon} className="mt-0.5 size-4" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onClose && (
        <button className="text-faint hover:text-ink" onClick={onClose} aria-label="Dismiss">
          <Icon name="x" className="size-4" />
        </button>
      )}
    </div>
  );
}

// "How it works" steps at the top of a page. Closed until you open it; remembered per page (storage may be blocked).
export function Guide({ id, title = 'How it works', steps }) {
  const key = `guide:${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage[key] === 'open'; // closed until you open it
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage[key] = open ? 'closed' : 'open';
    } catch {}
  };
  return (
    <section className="panel-info mb-5 overflow-hidden">
      <button className="flex w-full items-center gap-2.5 px-5 py-3 text-left text-sm font-semibold hover:bg-cobalt-soft" onClick={toggle} aria-expanded={open}>
        <span className="grid size-6 place-items-center rounded-md bg-surface text-cobalt">
          <Icon name="info" className="size-3.5" />
        </span>
        {title}
        <span className="ml-auto text-xs font-medium text-muted">{open ? 'Hide' : 'Show'}</span>
        <Icon name="chevron" className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="fade-in grid gap-4 border-t border-cobalt/20 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map(([head, body], i) => (
            <li key={head} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-cobalt/40 text-xs font-semibold text-cobalt tabular-nums">{i + 1}</span>
              <span className="text-sm leading-relaxed">
                <span className="font-semibold text-ink">{head}</span>
                <span className="block text-muted">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Daily allowance: "6 of 15 used · 9 left". Amber near the limit, red at it. goal: a marker on the bar.
// A collapsible status card: collapsed it is just that one line.
export function Quota({ id, label, used, limit, note, goal }) {
  const left = Math.max(0, limit - used);
  const full = left === 0;
  const near = !full && left <= Math.ceil(limit * 0.2);
  const bar = full ? 'bg-danger' : near ? 'bg-marigold' : 'bg-cobalt';
  const line = (
    <span className={`tabular-nums ${full ? 'font-semibold text-danger' : near ? 'font-semibold text-marigold' : ''}`}>
      {used} of {limit} used · {full ? 'limit reached' : `${left} left`}
    </span>
  );
  return (
    <Collapsible id={id ?? label} title={label} summary={line}>
      <div className="relative h-2 rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <div className={`h-2 rounded-full transition-[width] duration-500 ${bar}`} style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
        {goal > 0 && goal < limit && <span className="absolute -top-1 h-4 w-0.5 rounded bg-ink/40" style={{ left: `${(goal / limit) * 100}%` }} title={`Daily goal: ${goal}`} />}
      </div>
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </Collapsible>
  );
}

// A card with a one-line summary that opens into details. Closed until you open it; remembered per card (id).
// tone: status (white, teal top edge) | info (soft teal, for instructions) | plain
const TONE = { status: 'panel-status', info: 'panel-info', plain: 'panel' };
export function Collapsible({ id, title, icon, summary, children, tone = 'status', className = '' }) {
  const [state, setState] = useStoredState(`open:${id}`, 'closed');
  const open = state === 'open';
  return (
    <section className={`${TONE[tone]} ${className}`}>
      <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm" onClick={() => setState(open ? 'closed' : 'open')} aria-expanded={open}>
        {icon && <Icon name={icon} className="size-4 shrink-0 text-cobalt" />}
        <span className="font-semibold text-ink">{title}</span>
        {summary && <span className="min-w-0 truncate text-muted">· {summary}</span>}
        <Icon name="chevron" className={`ml-auto size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="fade-in border-t border-line px-4 py-3 text-sm">{children}</div>}
    </section>
  );
}

// Lists grow with "Load more" (no page numbers): the next batch is added below what you see.
// usePaged: lists already in the browser. Server lists (Jobs) pass the same props to <Pager> themselves.
export const PAGE_SIZE = 20;
export function usePaged(items, size = PAGE_SIZE) {
  const [shown, setShown] = useState(size);
  const visible = items.slice(0, shown);
  return { visible, pager: { count: visible.length, total: items.length, onMore: shown < items.length ? () => setShown(shown + size) : null } };
}
export function Pager({ count, total, onMore, noun = 'items', loading }) {
  if (!total) return null;
  return (
    <nav className="mt-4 flex flex-col items-center gap-2" aria-label={`More ${noun}`}>
      <span className="text-sm text-muted tabular-nums">
        Showing {count} of {total} {noun}
      </span>
      {onMore && (
        <button className="btn-outline min-w-44" onClick={onMore} disabled={loading}>
          {loading ? 'Loading…' : `Load more ${noun}`}
        </button>
      )}
    </nav>
  );
}

// "in 3 h 20 min": when a limit frees up.
export function untilText(date) {
  const min = Math.max(1, Math.round((new Date(date) - Date.now()) / 60_000));
  return min < 60 ? `in ${min} min` : `in ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

// A value kept in localStorage, so a page reopens where you left it. Storage can be blocked, hence the try.
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage[key] ?? initial;
    } catch {
      return initial;
    }
  });
  const set = (next) => {
    setValue(next);
    try {
      localStorage[key] = next;
    } catch {}
  };
  return [value, set];
}

// Tabs across the top of a page. done: true shows a green dot (finished), false an amber one (needs you).
// hint: a one-line description shown as a tooltip.
export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => {
        const active = t.id === value;
        const tab = (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
              active ? 'border-cobalt text-cobalt' : 'border-transparent text-muted hover:border-line hover:text-ink'
            }`}
          >
            {t.icon && <Icon name={t.icon} className="size-4" />}
            {t.label}
            {t.done != null && (
              <span className={`size-2 rounded-full ${t.done ? 'bg-ok' : 'bg-marigold'}`} aria-label={t.done ? '(done)' : '(to do)'} />
            )}
          </button>
        );
        return t.hint ? (
          <Tooltip key={t.id} text={t.hint}>
            {tab}
          </Tooltip>
        ) : (
          tab
        );
      })}
    </div>
  );
}

// "How to" instructions, styled apart from the content they explain: teal label, left rule, numbered steps.
export function Instructions({ title = 'How to', steps, children }) {
  return (
    <div className="rounded-r-lg border-l-4 border-cobalt bg-cobalt-soft/60 px-4 py-3">
      <p className="text-xs font-semibold tracking-wider text-cobalt uppercase">{title}</p>
      {steps && (
        <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-sm leading-relaxed text-ink marker:font-semibold marker:text-cobalt">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {children && <div className="mt-1.5 text-sm leading-relaxed text-ink">{children}</div>}
    </div>
  );
}

// The standard card: title, one-line description and actions on top; instructions, then content.
export function SectionCard({ id, title, description, actions, instructions, children }) {
  return (
    <section id={id} className="panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="section-title">{title}</h2>
          {description && <p className="section-desc">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="space-y-5 px-5 py-5 sm:px-6">
        {instructions}
        {children}
      </div>
    </section>
  );
}

// A small dark tip shown on hover or keyboard focus of its child. Pure CSS, so nothing to wire up.
export function Tooltip({ text, children }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 w-60 -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-left text-xs leading-snug font-normal text-paper opacity-0 shadow-lg transition-opacity group-focus-within/tip:opacity-100 group-hover/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

// Numbered steps down the page: done ones get a tick, the first unfinished one is highlighted as "current".
// steps: [{ title, done, content }]
export function Stepper({ steps }) {
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const state = s.done ? 'done' : i === current ? 'current' : 'next';
        return (
          <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0">
            {i < steps.length - 1 && <span className={`absolute top-8 bottom-0 left-[15px] w-0.5 ${s.done ? 'bg-cobalt' : 'bg-line'}`} aria-hidden="true" />}
            <span
              className={`relative grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold ${
                state === 'done' ? 'border-cobalt bg-cobalt text-on-accent' : state === 'current' ? 'border-cobalt bg-surface text-cobalt' : 'border-line bg-surface text-faint'
              }`}
              aria-hidden="true"
            >
              {state === 'done' ? <Icon name="check" className="size-4" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <h3 className={`font-semibold ${state === 'next' ? 'text-muted' : 'text-ink'}`}>
                <span className="sr-only">Step {i + 1}{state === 'done' ? ' (done)' : ''}: </span>
                {s.title}
              </h3>
              <div className="mt-3">{s.content}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Opens Settings on a given tab (it remembers its tab in localStorage under "settingsTab").
export function goToSettings(onNavigate, tab) {
  try {
    localStorage.settingsTab = tab;
  } catch {}
  onNavigate('profile');
}

// A labelled switch with a one-line hint underneath.
export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2" title={hint}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-cobalt peer-focus-visible:outline-2 peer-focus-visible:outline-cobalt after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
      <span className="leading-tight">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-faint">{hint}</span>
      </span>
    </label>
  );
}
