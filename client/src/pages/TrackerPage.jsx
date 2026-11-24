import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Collapsible, Guide, Icon, Notice, PageHeader, Pager, timeAgo, toast, usePaged } from '../components/ui.jsx';
import { MailAccount } from '../components/MailAccount.jsx';

// Every application in one place. Sent emails and applied forms arrive here on their own;
// replies in your Gmail move cards forward; you can move any card yourself.
const STAGES = [
  ['applied', 'Applied'],
  ['replied', 'Replied'],
  ['interview', 'Interview'],
  ['offer', 'Offer'],
  ['rejected', 'Rejected'],
];
const STAGE_TONE = {
  applied: 'bg-cobalt-soft text-cobalt',
  replied: 'bg-pink-soft text-pink',
  interview: 'bg-ok-soft text-ok',
  offer: 'bg-ok text-on-accent',
  rejected: 'bg-sunken text-muted',
};
const KIND = { email: 'HR email', form: 'Auto-apply', manual: 'Applied yourself' };
const RANGES = [
  ['today', 'Today', 1],
  ['week', 'This week', 7],
  ['month', 'This month', 30],
  ['all', 'All time', null],
];
const STEPS = [
  ['Applications arrive by themselves', 'Every HR email you send and every auto-apply you submit becomes a card under Applied.'],
  ['Replies move cards', 'Every 30 minutes the app reads your Gmail. A reply moves the card to Replied or Interview.'],
  ['Applied somewhere else?', 'Press Add application, or "I applied here" on a Naukri or Indeed job, so it is counted too.'],
  ['Move cards yourself', 'Change the stage on any card. Open a card for the reply, notes and its full history.'],
  ['See your history', 'Switch to List and history for every application with its date, how you applied, and where it stands.'],
];
const days = (d) => Math.floor((Date.now() - new Date(d)) / 86_400_000);
const ago = (d) => (days(d) === 0 ? 'today' : days(d) === 1 ? 'yesterday' : `${days(d)} days ago`);
const stageName = (v) => STAGES.find(([s]) => s === v)?.[1];

export default function TrackerPage({ onNavigate }) {
  const queryClient = useQueryClient();
  const board = useQuery({ queryKey: ['tracker'], queryFn: () => api('/tracker') });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tracker'] });
    queryClient.invalidateQueries({ queryKey: ['today'] });
  };
  const check = useMutation({
    mutationFn: () => api('/tracker/check-inbox', { method: 'POST' }),
    onSuccess: refresh,
    meta: { success: (d) => (d.updated ? `Inbox checked: ${d.updated} ${d.updated === 1 ? 'card' : 'cards'} updated` : 'Inbox checked: no new replies') },
  });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('board');

  const items = board.data?.items ?? [];
  const inbox = board.data?.inbox;
  const stats = [
    [items.length, 'applications in total'],
    [items.filter((c) => days(c.appliedAt) < 7).length, 'applied this week'],
    [items.filter((c) => ['replied', 'interview', 'offer'].includes(c.stage)).length, 'got a reply'],
    [items.filter((c) => c.stage === 'interview').length, 'at interview'],
  ];

  return (
    <div>
      <PageHeader
        title="Tracker"
        actions={
          <>
            <button className="btn-outline" disabled={!inbox?.ready || check.isPending} title={inbox?.ready ? 'Read Gmail for replies now' : 'Connect Gmail first'} onClick={() => check.mutate()}>
              <Icon name="mail" />
              {check.isPending ? 'Checking…' : 'Check inbox now'}
            </button>
            <button className="btn" onClick={() => setAdding(!adding)}>
              {adding ? 'Close' : 'Add application'}
            </button>
          </>
        }
      >
        Every application you made and where it stands. Replies in your Gmail move cards forward on their own.
      </PageHeader>

      {/* alerts first */}
      {inbox && !inbox.ready && <MailAccount compact onNavigate={onNavigate} />}
      {inbox?.error && <Notice tone="error">{inbox.error}</Notice>}

      {items.length > 0 && (
        <Collapsible
          id="tracker-summary"
          icon="tracker"
          title="Summary"
          summary={`${stats.map(([n, label]) => `${n} ${label}`).join(' · ')}${inbox?.lastCheck && !inbox.error ? ` · inbox checked ${timeAgo(inbox.lastCheck)}` : ''}`}
          className="mb-5"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map(([n, label]) => (
              <div key={label} className="rounded-lg bg-paper px-4 py-3">
                <p className="text-2xl font-semibold tabular-nums">{n}</p>
                <p className="text-xs font-medium text-muted">{label}</p>
              </div>
            ))}
          </div>
          {inbox?.lastCheck && !inbox.error && <p className="mt-2 text-xs text-muted">Inbox last checked {timeAgo(inbox.lastCheck)}. It checks again every 30 minutes.</p>}
        </Collapsible>
      )}
      <Guide id="tracker" title="How tracking works" steps={STEPS} />
      {adding && <AddCard onDone={() => (setAdding(false), refresh())} />}

      {board.isError && <Notice tone="error">Couldn't load your applications: {board.error.message}. Reload the page to try again.</Notice>}
      {board.isPending && <div className="panel h-40 animate-pulse" aria-label="Loading applications" />}
      {board.data && !items.length && (
        <div className="panel px-6 py-14 text-center">
          <p className="text-lg font-semibold tracking-tight">Track your first application</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Send an HR email from the Email page, submit an auto-application from Jobs, or press Add application for one you made elsewhere.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="mb-3 inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="View">
          {[
            ['board', 'Board', 'board'],
            ['list', 'List and history', 'list'],
          ].map(([key, label, icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm ${view === key ? 'bg-cobalt font-semibold text-on-accent shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <Icon name={icon} className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && view === 'board' && (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
          {STAGES.map(([stage, label]) => (
            <Column key={stage} label={label} cards={items.filter((c) => c.stage === stage)} open={open} setOpen={setOpen} onChange={refresh} />
          ))}
        </div>
      )}
      {items.length > 0 && view === 'list' && <History items={items} onChange={refresh} />}
    </div>
  );
}

// One stage on the board: 8 cards, then "Load more".
function Column({ label, cards, open, setOpen, onChange }) {
  const { visible, pager } = usePaged(cards, 8);
  return (
    <section className="w-64 shrink-0 rounded-xl bg-sunken p-2" aria-label={label}>
      <h2 className="flex items-center justify-between px-1.5 py-1 text-sm font-semibold">
        {label}
        <span className="rounded-full bg-surface px-2 text-xs text-muted">{cards.length}</span>
      </h2>
      <div className="mt-1 flex flex-col gap-2">
        {visible.map((c) => (
          <Card key={c._id} card={c} open={open === c._id} onToggle={() => setOpen(open === c._id ? null : c._id)} onChange={onChange} />
        ))}
        {!cards.length && <p className="px-1.5 py-3 text-xs text-faint">None yet</p>}
      </div>
      {pager.onMore && (
        <button className="btn-ghost mt-2 w-full justify-center font-semibold text-cobalt" onClick={pager.onMore}>
          Load more ({cards.length - visible.length} left)
        </button>
      )}
    </section>
  );
}

// Every application as a table: when, where, how, and where it stands now.
function History({ items, onChange }) {
  const [range, setRange] = useState('week');
  const [q, setQ] = useState('');
  const limit = RANGES.find(([k]) => k === range)[2];
  const text = q.trim().toLowerCase();
  const rows = items.filter((c) => (!limit || days(c.appliedAt) < limit) && (!text || `${c.company} ${c.role ?? ''}`.toLowerCase().includes(text)));
  const { visible, pager } = usePaged(rows);
  const move = useMutation({
    mutationFn: ({ id, stage }) => api(`/tracker/${id}`, { method: 'PUT', body: { stage } }),
    onSuccess: onChange,
    meta: { success: (_d, { company, stage }) => `${company} moved to ${stageName(stage)}` },
  });
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunken px-4 py-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Period">
          {RANGES.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={range === key}
              onClick={() => setRange(key)}
              className={`rounded-md px-3 py-1 text-sm ${range === key ? 'bg-cobalt font-semibold text-on-accent shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input className="input w-full sm:ml-auto sm:w-60" placeholder="Search company or role" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!rows.length ? (
        <p className="px-4 py-10 text-center text-sm text-muted">No applications in this period. Pick a longer period above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-sunken/50 text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Applied</th>
                <th className="px-2 py-2 font-semibold">Company and role</th>
                <th className="px-2 py-2 font-semibold">How</th>
                <th className="px-2 py-2 font-semibold">Stage</th>
                <th className="px-2 py-2 font-semibold">Last update</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((c) => {
                const last = c.history.at(-1);
                return (
                  <tr key={c._id} className="fade-in hover:bg-sunken/40">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <p className="font-medium">{new Date(c.appliedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p>
                      <p className="text-xs text-faint">{ago(c.appliedAt)}</p>
                    </td>
                    <td className="px-2 py-2.5">
                      <p className="font-semibold">
                        {c.company}
                        {c.unread && <span className="ml-2 rounded bg-pink-soft px-1.5 py-0.5 text-xs font-semibold text-pink">New reply</span>}
                      </p>
                      {c.role && <p className="text-xs text-muted">{c.role}</p>}
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted">{KIND[c.kind]}</td>
                    <td className="px-2 py-2.5">
                      <select
                        className={`rounded-md border-0 px-2 py-1 text-xs font-semibold ${STAGE_TONE[c.stage]}`}
                        value={c.stage}
                        aria-label={`Stage for ${c.company}`}
                        onChange={(e) => move.mutate({ id: c._id, stage: e.target.value, company: c.company })}
                      >
                        {STAGES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-muted">
                      {last ? `${stageName(last.stage)} · ${ago(last.at)}${last.by === 'inbox' ? ' (from Gmail)' : ''}` : '-'}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {c.url && (
                        <a className="btn-ghost px-2" href={c.url} target="_blank" rel="noreferrer" aria-label={`Open ${c.company} application`} title="Open application">
                          <Icon name="external" />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line px-4 pb-4">
        <Pager {...pager} noun="applications" />
      </div>
    </section>
  );
}

function Card({ card, open, onToggle, onChange }) {
  const [notes, setNotes] = useState(card.notes);
  const update = useMutation({
    meta: { inline: true, success: (_d, body) => (body.notes != null ? 'Notes saved' : body.stage ? `Moved to ${stageName(body.stage)}` : null) },
    mutationFn: (body) => api(`/tracker/${card._id}`, { method: 'PUT', body }),
    onSuccess: onChange,
  });
  const remove = useMutation({ meta: { inline: true, success: 'Application deleted' }, mutationFn: () => api(`/tracker/${card._id}`, { method: 'DELETE' }), onSuccess: onChange });
  const toggle = () => {
    onToggle();
    if (!open && card.unread) update.mutate({ read: true }); // opening a card marks its reply as read
  };
  const error = update.error ?? remove.error;

  return (
    <article className="fade-in rounded-lg border border-line bg-surface p-3 text-sm shadow-sm transition hover:border-cobalt/40 hover:shadow-md">
      <button className="block w-full text-left" onClick={toggle} aria-expanded={open}>
        <span className="flex items-start justify-between gap-2">
          <span className="font-medium">{card.company}</span>
          {card.unread && <span className="shrink-0 rounded bg-pink-soft px-1.5 py-0.5 text-xs font-semibold text-pink">New reply</span>}
        </span>
        {card.role && <span className="mt-0.5 block text-muted">{card.role}</span>}
        <span className="mt-1.5 block text-xs text-faint">
          {KIND[card.kind]} · {ago(card.appliedAt)}
        </span>
      </button>

      <label className="mt-2 block">
        <span className="sr-only">Move {card.company} to</span>
        <select className="input py-1 text-xs" value={card.stage} disabled={update.isPending} onChange={(e) => update.mutate({ stage: e.target.value })}>
          {STAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {card.reply?.subject && (
            <div>
              <p className="text-xs text-muted">
                Reply from {card.reply.from}, {timeAgo(card.reply.at)}
              </p>
              <p className="mt-1 font-medium">{card.reply.subject}</p>
              <p className="mt-1 text-muted">{card.reply.snippet}…</p>
            </div>
          )}
          {card.to && <p className="text-xs text-muted">HR: {card.to}</p>}
          {card.url && (
            <a className="inline-flex items-center gap-1 text-xs text-cobalt hover:underline" href={card.url} target="_blank" rel="noreferrer">
              Open application <Icon name="external" className="size-3" />
            </a>
          )}
          {card.tailoredResume && (
            <button
              className="ml-3 inline-flex items-center gap-1 text-xs text-pink hover:underline"
              onClick={() => api(`/${card.kind === 'form' ? 'apply' : 'outreach'}/${card.sourceId}/resume`, { blob: true }).then((b) => window.open(URL.createObjectURL(b), '_blank', 'noopener'), (err) => toast(err.message, 'error'))}
            >
              <Icon name="sparkle" className="size-3" /> Resume they got (tailored)
            </button>
          )}
          <label className="block">
            <span className="text-xs text-muted">Notes</span>
            <textarea className="input mt-1 min-h-16 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="flex items-center gap-2">
            <button className="btn-outline" disabled={notes === card.notes || update.isPending} onClick={() => update.mutate({ notes })}>
              Save notes
            </button>
            {card.kind === 'manual' && (
              <button className="btn-ghost text-danger" disabled={remove.isPending} onClick={() => confirm(`Delete ${card.company}?`) && remove.mutate()}>
                Delete
              </button>
            )}
          </div>
          <ol className="space-y-0.5 text-xs text-faint">
            {card.history.map((h, i) => (
              <li key={i}>
                {STAGES.find(([v]) => v === h.stage)?.[1]} · {new Date(h.at).toLocaleDateString()} {h.by === 'inbox' ? '(from inbox)' : h.by === 'you' ? '(by you)' : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error.message}</p>}
    </article>
  );
}

// An application made outside the app: Naukri, a referral, a career site.
function AddCard({ onDone }) {
  const [form, setForm] = useState({ company: '', role: '', url: '', to: '' });
  const add = useMutation({ meta: { inline: true, success: 'Added to Applied' }, mutationFn: () => api('/tracker', { method: 'POST', body: form }), onSuccess: onDone });
  const field = (key, label, type = 'text') => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input mt-1" type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required={key === 'company'} />
    </label>
  );
  return (
    <form
      className="panel mb-5 grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      {field('company', 'Company')}
      {field('role', 'Role')}
      {field('url', 'Job or application link', 'url')}
      {field('to', 'HR email (replies from it are tracked)', 'email')}
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn" disabled={add.isPending}>
          Add to Applied
        </button>
        {add.isError && <span className="text-sm text-danger">{add.error.message}</span>}
      </div>
    </form>
  );
}
