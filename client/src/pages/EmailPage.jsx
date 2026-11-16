import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Icon, PageHeader, timeAgo } from '../components/ui.jsx';

// One list for emailing HR: every HR contact with company, role, name and email. Tick one or many ->
// AI writes each email -> check them in the row -> tick and Send. Nothing is sent without your click.
const SOURCE = { 'job post': 'Job post', 'company site': 'Company site', hunter: 'Hunter', manual: 'Added by you' };
const FILTERS = [
  ['all', 'All'],
  ['new', 'Not written'],
  ['ready', 'Ready'],
  ['sent', 'Sent'],
];

// Where a row stands: what the Status column says and which actions it allows.
function stateOf(c) {
  const m = c.mail;
  if (c.writing) return { key: 'writing', label: 'Writing…', tone: 'text-cobalt' };
  if (m?.status === 'queued') return { key: 'sending', label: 'Sending…', tone: 'text-cobalt' };
  if (m && ['draft', 'approved'].includes(m.status)) return { key: 'ready', label: 'Ready', tone: 'text-ok', canSend: true };
  if (m?.status === 'failed') return { key: 'ready', label: "Didn't send", tone: 'text-danger', canSend: true };
  if (m?.status === 'sent' && c.recent) return { key: 'sent', label: `Sent ${timeAgo(m.sentAt)}`, tone: 'text-muted' };
  if (!c.sendable) return { key: 'none', label: c.email ? 'Unverified email' : 'No email', tone: 'text-faint' };
  return { key: 'new', label: m?.status === 'sent' ? `Sent ${timeAgo(m.sentAt)}` : 'Not written', tone: 'text-muted', canWrite: true };
}

export default function EmailPage({ onNavigate }) {
  const queryClient = useQueryClient();
  const refresh = () => ['contacts', 'outboxStatus'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  const status = useQuery({ queryKey: ['outboxStatus'], queryFn: () => api('/outreach/status'), refetchInterval: (q) => (q.state.data?.preparing ? 4000 : 15000) });
  const contacts = useQuery({
    queryKey: ['contacts'],
    queryFn: () => api('/contacts'),
    // keep it live while emails are written or sent, or contacts are being found
    refetchInterval: (q) => (q.state.data?.finding || status.data?.preparing || q.state.data?.items.some((c) => c.writing || c.mail?.status === 'queued') ? 4000 : false),
  });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api('/profile') });
  useEffect(() => {
    // opening the page also looks for new HR contacts in the background (at most once an hour)
    api('/contacts/refresh', { method: 'POST' })
      .then((r) => r.started && refresh())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [filter, setFilter] = useState('all');
  const [onlyActive, setOnlyActive] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [openRow, setOpenRow] = useState(null);
  const [panel, setPanel] = useState(null); // 'add' | 'paste'

  const discover = useMutation({ mutationFn: () => api('/contacts/discover', { method: 'POST' }), onSuccess: refresh });
  const prepare = useMutation({ mutationFn: () => api('/outreach/prepare', { method: 'POST' }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id) => api(`/contacts/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const write = useMutation({
    mutationFn: (contactIds) => api('/outreach/drafts', { method: 'POST', body: { contactIds } }),
    onSuccess: () => (setSelected([]), refresh()),
  });
  const send = useMutation({
    mutationFn: (ids) => api('/outreach/send', { method: 'POST', body: { ids, approve: true } }),
    onSuccess: () => (setSelected([]), refresh()),
  });

  const s = status.data;
  const all = contacts.data?.items ?? [];
  const q = query.trim().toLowerCase();
  const rows = all.filter(
    (c) =>
      (!onlyActive || c.jobs.length || c.source === 'manual' || c.mail) &&
      (filter === 'all' || stateOf(c).key === filter) &&
      (!q || `${c.company} ${c.name ?? ''} ${c.email ?? ''} ${c.position ?? ''} ${c.jobs[0]?.title ?? ''}`.toLowerCase().includes(q)),
  );
  const pickable = rows.filter((c) => stateOf(c).canWrite || stateOf(c).canSend);
  const chosen = all.filter((c) => selected.includes(c._id));
  const toWrite = chosen.filter((c) => stateOf(c).canWrite);
  const toSend = chosen.filter((c) => stateOf(c).canSend);
  const allSelected = pickable.length > 0 && pickable.every((c) => selected.includes(c._id));
  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : selected.length < 25 ? [...selected, id] : selected);
  const count = (key) => all.filter((c) => stateOf(c).key === key).length;
  const noPdf = profile.data && !profile.data.resumePdf?.id;

  return (
    <div className="pb-28">
      <PageHeader
        title="Email"
        actions={
          <button className="btn-outline" onClick={() => prepare.mutate()} disabled={prepare.isPending || s?.preparing || noPdf} title="The app picks your best-fit companies">
            <Icon name="sparkle" />
            {s?.preparing ? 'Writing emails…' : `Write ${s?.dailyGoal ?? 10} for me`}
          </button>
        }
      >
        HR contacts at companies with active jobs. Tick one or many and AI writes each email for that role; check them, then send.
      </PageHeader>

      {s && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Stat label="Sent today" value={`${s.sentToday} / ${s.dailyGoal}`} bar={Math.min(1, s.sentToday / s.dailyGoal)} />
          <Stat label="Ready to send" value={count('ready')} note={s.preparing ? 'Writing more…' : null} />
          <Stat label="Streak" value={`${s.streak} ${s.streak === 1 ? 'day' : 'days'}`} note={`Limit ${s.dailyLimit} in 24 hours`} />
        </div>
      )}
      {noPdf && (
        <p className="mb-4 rounded-lg bg-marigold-soft px-3 py-2 text-sm text-ink">
          Upload your resume PDF first: every email attaches it, so none can be written until then.{' '}
          <button className="font-medium text-cobalt hover:underline" onClick={() => onNavigate('profile')}>
            Go to Profile
          </button>
        </p>
      )}
      {s && !s.gmail && (
        <p className="mb-4 rounded-lg bg-sunken px-3 py-2 text-sm text-muted">
          Gmail isn't connected yet, so emails can be written and checked but not sent. Add <code>GMAIL_USER</code> and <code>GMAIL_APP_PASSWORD</code> to{' '}
          <code>server/.env</code> when you're ready.
        </p>
      )}
      {[prepare, write, send, discover].map((m, i) => m.isError && <p key={i} className="mb-4 text-sm text-danger">{m.error.message}</p>)}
      {prepare.data?.writing === 0 && <p className="mb-4 text-sm text-marigold">No new contacts to write to right now.</p>}
      {send.data && (
        <p className="mb-4 text-sm text-ok">
          {send.data.queued} sending, a little apart.
          {send.data.skipped.length > 0 && <span className="text-marigold"> Held back: {send.data.skipped.map((x) => `${x.to} (${x.reason})`).join('; ')}</span>}
        </p>
      )}
      {write.data?.skipped.length > 0 && <p className="mb-4 text-xs text-marigold">Skipped: {write.data.skipped.map((x) => `${x.contact} (${x.reason})`).join('; ')}</p>}
      {s?.lastPrepared?.skipped?.length > 0 && !s.preparing && (
        <p className="mb-4 text-xs text-marigold">Last writing run skipped: {s.lastPrepared.skipped.map((x) => `${x.contact} (${x.reason})`).join('; ')}</p>
      )}
      {contacts.data?.finding && (
        <p className="mb-4 rounded-lg bg-sunken px-3 py-2 text-sm text-muted" role="status">
          Looking for more HR contacts on your top jobs' posts and company websites…
        </p>
      )}

      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Show">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1 text-sm ${filter === key ? 'bg-ink font-medium text-surface' : 'text-muted hover:text-ink'}`}
            >
              {label}
              {key !== 'all' && contacts.data ? ` (${count(key)})` : ''}
            </button>
          ))}
        </div>
        <input className="input w-full sm:w-60" placeholder="Search company, role, name, email" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={onlyActive} onChange={() => setOnlyActive(!onlyActive)} />
          Only companies with active jobs
        </label>
        <span className="ml-auto flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setPanel(panel === 'add' ? null : 'add')}>
            Add contact
          </button>
          <button className="btn-ghost" onClick={() => setPanel(panel === 'paste' ? null : 'paste')}>
            Paste a list
          </button>
          <button className="btn-ghost" onClick={() => discover.mutate()} disabled={discover.isPending}>
            <Icon name="search" />
            {discover.isPending ? 'Finding…' : 'Find more HR'}
          </button>
        </span>
      </div>
      {discover.data && <p className="mb-3 text-sm text-muted">Checked {discover.data.checked} company sites, found {discover.data.found} new contacts.</p>}
      {panel === 'add' && <AddContact onDone={() => (setPanel(null), refresh())} />}
      {panel === 'paste' && <PasteList onDone={refresh} onClose={() => setPanel(null)} />}
      {contacts.data && <HunterBox status={contacts.data.hunter} onFound={refresh} />}

      {contacts.isPending && <p className="text-sm text-muted">Loading…</p>}
      {contacts.isError && <p className="text-sm text-danger">{contacts.error.message}</p>}
      {contacts.data && !rows.length && (
        <div className="panel px-6 py-14 text-center text-sm text-muted">
          {all.length ? 'Nothing matches this filter.' : 'No HR contacts yet. Find more HR, look one up on Hunter, or add or paste ones you found.'}
        </div>
      )}

      {rows.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="w-10 px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    disabled={!pickable.length}
                    onChange={() => setSelected(allSelected ? [] : pickable.slice(0, 25).map((c) => c._id))}
                  />
                </th>
                <th className="px-2 py-2 font-medium">Company</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">HR name</th>
                <th className="px-2 py-2 font-medium">Email</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => {
                const st = stateOf(c);
                const canPick = st.canWrite || st.canSend;
                const isOpen = openRow === c._id && c.mail;
                return (
                  <Fragment key={c._id}>
                    <tr className={selected.includes(c._id) ? 'bg-sunken' : undefined}>
                      <td className="px-4 py-2.5 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.email || c.company}`}
                          checked={selected.includes(c._id)}
                          disabled={!canPick}
                          title={canPick ? undefined : st.label}
                          onChange={() => toggle(c._id)}
                        />
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <p className="font-medium">{c.company}</p>
                        {c.domain && <p className="text-xs text-faint">{c.domain}</p>}
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        {c.jobs.length ? (
                          <>
                            <a className="hover:underline" href={c.jobs[0].url} target="_blank" rel="noreferrer">
                              {c.jobs[0].title}
                            </a>
                            <p className="text-xs text-faint">
                              fit {c.jobs[0].fit}
                              {c.jobs.length > 1 && ` · +${c.jobs.length - 1} more`}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-faint">{c.jobTitle || 'No active job'}</span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <p>{c.name || <span className="text-muted">Hiring team</span>}</p>
                        {c.position && <p className="text-xs text-muted">{c.position}</p>}
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        {c.email ? <p className="break-all text-cobalt">{c.email}</p> : <p className="text-xs text-faint">{c.phone ?? '–'}</p>}
                        <p className="text-xs text-faint">{SOURCE[c.source]}{c.source === 'hunter' && ` ${c.confidence ?? '?'}%`}</p>
                      </td>
                      <td className={`px-2 py-2.5 align-top text-xs font-medium ${st.tone}`}>{st.label}</td>
                      <td className="px-2 py-2.5 text-right align-top whitespace-nowrap">
                        {c.mail && (
                          <button className="btn-ghost px-2 text-xs" onClick={() => setOpenRow(isOpen ? null : c._id)} aria-expanded={Boolean(isOpen)}>
                            {isOpen ? 'Close' : st.key === 'ready' ? 'Check' : 'View'}
                          </button>
                        )}
                        <button className="btn-ghost px-2 hover:text-danger" aria-label="Delete contact" title="Delete contact" onClick={() => remove.mutate(c._id)}>
                          <Icon name="trash" />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} className="bg-paper px-4 py-4">
                          <EmailEditor key={`${c.mail._id}-${c.mail.updatedAt}`} mail={c.mail} profile={profile.data?.data} onChange={refresh} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {contacts.data?.uncovered.length > 0 && <Uncovered companies={contacts.data.uncovered} hunter={contacts.data.hunter} onFound={refresh} />}

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{selected.length} selected</span>
            <span className="text-xs text-muted">Sending approves them · one email per company per day</span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setSelected([])}>
                Clear
              </button>
              {toWrite.length > 0 && (
                <button className="btn-outline" disabled={write.isPending || s?.preparing || noPdf} onClick={() => write.mutate(toWrite.map((c) => c._id))}>
                  <Icon name="sparkle" />
                  Write {toWrite.length} {toWrite.length === 1 ? 'email' : 'emails'}
                </button>
              )}
              {toSend.length > 0 && (
                <button className="btn" disabled={send.isPending || !s?.gmail} title={s?.gmail ? undefined : 'Connect Gmail first'} onClick={() => send.mutate(toSend.map((c) => c.mail._id))}>
                  <Icon name="mail" />
                  {send.isPending ? 'Sending…' : `Send ${toSend.length}`}
                </button>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, note, bar }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display text-2xl font-semibold tracking-tight">{value}</p>
      {bar != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-ok" style={{ width: `${bar * 100}%` }} />
        </div>
      )}
      {note && <p className="mt-1 text-xs text-faint">{note}</p>}
    </div>
  );
}

// The email in its row: subject, preview or edit, warnings. Sent emails are read-only.
function EmailEditor({ mail, profile, onChange }) {
  const [view, setView] = useState('preview');
  const [draft, setDraft] = useState({ subject: mail.subject, body: mail.body });
  const editable = ['draft', 'approved', 'failed'].includes(mail.status);
  const dirty = draft.subject !== mail.subject || draft.body !== mail.body;
  const save = useMutation({ mutationFn: () => api(`/outreach/${mail._id}`, { method: 'PUT', body: draft }), onSuccess: onChange });
  const discard = useMutation({ mutationFn: () => api(`/outreach/${mail._id}`, { method: 'DELETE' }), onSuccess: onChange });
  const error = save.error ?? discard.error;

  return (
    <div className="max-w-3xl space-y-3 text-sm">
      {editable ? (
        <label className="block">
          <span className="text-xs font-medium text-muted">Subject</span>
          <input className="input mt-1" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        </label>
      ) : (
        <p className="font-medium">{mail.subject}</p>
      )}
      {editable && (
        <div className="flex gap-1 text-xs" role="tablist">
          {['preview', 'edit'].map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded px-2 py-1 ${view === v ? 'bg-sunken font-medium' : 'text-muted'}`}>
              {v === 'preview' ? 'Preview' : 'Edit'}
            </button>
          ))}
        </div>
      )}
      {editable && view === 'edit' ? (
        <>
          <textarea className="input font-sans leading-relaxed" rows={14} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <p className="text-xs text-faint">Blank line = new paragraph, "- " = bullet, **text** = bold. Your signature and resume PDF are added automatically.</p>
        </>
      ) : (
        <EmailPreview body={draft.body} profile={profile} />
      )}
      {mail.warnings?.length > 0 && editable && (
        <ul className="space-y-0.5 text-xs text-marigold">
          {mail.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {mail.status === 'failed' && <p className="text-xs text-danger">Didn't send: {mail.error}</p>}
      {error && <p className="text-danger">{error.issues?.[0]?.message ?? error.message}</p>}
      {editable && (
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <button className="btn" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
          )}
          <button className="btn-ghost hover:text-danger" onClick={() => confirm('Discard this email?') && discard.mutate()} disabled={discard.isPending}>
            <Icon name="trash" />
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

// Same rules as the server's mail/format.js, drawn as React elements (no raw HTML).
function Bold({ text }) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
}

function EmailPreview({ body, profile }) {
  const c = profile?.contact ?? {};
  return (
    <div className="mt-1 rounded-lg border border-line bg-paper px-4 py-3 font-sans leading-relaxed">
      {body
        .trim()
        .split(/\n\s*\n/)
        .map((block, i) => {
          const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.every((l) => /^[-•*]\s+/.test(l)))
            return (
              <ul key={i} className="mb-3 list-disc pl-5">
                {lines.map((l, j) => (
                  <li key={j}>
                    <Bold text={l.replace(/^[-•*]\s+/, '')} />
                  </li>
                ))}
              </ul>
            );
          return (
            <p key={i} className="mb-3">
              {lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Bold text={l} />
                </Fragment>
              ))}
            </p>
          );
        })}
      <p className="mt-4 text-muted">
        <b className="text-ink">{c.name}</b>
        <br />
        {[c.phone, c.email].filter(Boolean).join(' · ')}
        {c.links?.length > 0 && (
          <>
            <br />
            <span className="text-cobalt">{c.links.slice(0, 3).map((l) => l.replace(/^https?:\/\/(www\.)?/i, '')).join(' · ')}</span>
          </>
        )}
      </p>
    </div>
  );
}

// Companies with active jobs and no HR contact yet: one click to look for one.
function Uncovered({ companies, hunter, onFound }) {
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const run = async (key, fn) => {
    setBusy(key);
    setMessage(null);
    try {
      setMessage(await fn());
      onFound();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold tracking-tight">Active companies with no HR contact yet</h2>
      <p className="text-sm text-muted">Your best-fit companies we have no email for. Look one up, or add a contact you found.</p>
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface text-sm">
        {companies.map(({ company, jobs }) => (
          <li key={company} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
            <span className="font-medium">{company}</span>
            <span className="min-w-0 flex-1 truncate text-muted">
              {jobs[0].title} · fit {jobs[0].fit}
              {jobs.length > 1 && ` · +${jobs.length - 1} more`}
            </span>
            <button
              className="btn-ghost px-2 text-xs"
              disabled={busy !== null}
              onClick={() =>
                run(`site-${company}`, async () => {
                  const found = await api(`/jobs/${jobs[0].matchId}/contacts`, { method: 'POST' });
                  return found.emails.length ? `${company}: found ${found.emails.length} email(s).` : `${company}: ${found.note ?? 'no email in the job post or on its website'}`;
                })
              }
            >
              {busy === `site-${company}` ? 'Checking…' : 'Check job post & website'}
            </button>
            {hunter.configured && (
              <button
                className="btn-ghost px-2 text-xs"
                disabled={busy !== null || hunter.used >= hunter.limit}
                onClick={() =>
                  run(`hunter-${company}`, async () => {
                    const r = await api('/contacts/hunter', { method: 'POST', body: { company, jobId: String(jobs[0].jobId) } });
                    return `${company}: ${r.contacts.length} HR contact(s) from Hunter${r.cached ? ' (earlier lookup, no credit used)' : ''}.`;
                  })
                }
              >
                {busy === `hunter-${company}` ? 'Looking up…' : 'Find on Hunter'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HunterBox({ status, onFound }) {
  const [form, setForm] = useState({ domain: '', company: '' });
  const look = useMutation({ mutationFn: () => api('/contacts/hunter', { method: 'POST', body: form }), onSuccess: onFound });
  if (!status.configured)
    return (
      <p className="mb-4 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-muted">
        To look up HR people by company, create a free Hunter.io account and add <code>HUNTER_API_KEY</code> to <code>server/.env</code>.
      </p>
    );
  return (
    <form
      className="panel mb-4 flex flex-wrap items-end gap-3 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        look.mutate();
      }}
    >
      <label className="block">
        <span className="text-xs font-medium text-muted">Company name</span>
        <input className="input mt-1 w-56" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-muted">or its website (more accurate)</span>
        <input className="input mt-1 w-56" placeholder="acme.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
      </label>
      <button className="btn-outline" disabled={look.isPending || status.used >= status.limit || !(form.company.trim() || form.domain.trim())}>
        {look.isPending ? 'Looking up…' : 'Find HR on Hunter'}
      </button>
      <span className="text-xs text-faint">
        {status.used} of {status.limit} lookups used this month.
        {look.data && ` ${look.data.contacts.length} HR contacts${look.data.cached ? ' (from an earlier lookup, no credit used)' : ''}.`}
      </span>
      {look.isError && <p className="w-full text-sm text-danger">{look.error.issues?.[0]?.message ?? look.error.message}</p>}
    </form>
  );
}

function AddContact({ onDone }) {
  const [form, setForm] = useState({ company: '', name: '', position: '', email: '', phone: '', jobTitle: '' });
  const add = useMutation({ mutationFn: () => api('/contacts', { method: 'POST', body: form }), onSuccess: onDone });
  const field = (key, label, props = {}) => (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input className="input mt-1" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </label>
  );
  return (
    <form
      className="panel mb-4 space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <p className="text-sm text-muted">Someone you found yourself, for example on LinkedIn or a company's team page.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {field('company', 'Company', { required: true })}
        {field('name', 'Name')}
        {field('position', 'Their position', { placeholder: 'e.g. HR Manager' })}
        {field('email', 'Email', { type: 'email' })}
        {field('phone', 'Phone', { type: 'tel' })}
        {field('jobTitle', 'Role you are applying for')}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add contact'}
        </button>
        <button type="button" className="btn-ghost" onClick={onDone}>
          Cancel
        </button>
        {add.isError && <span className="text-sm text-danger">{add.error.issues?.[0]?.message ?? add.error.message}</span>}
      </div>
    </form>
  );
}

function PasteList({ onDone, onClose }) {
  const [text, setText] = useState('');
  const paste = useMutation({ mutationFn: () => api('/contacts/import', { method: 'POST', body: { text } }), onSuccess: (r) => (r.added && setText(''), onDone()) });
  return (
    <form
      className="panel mb-4 space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        paste.mutate();
      }}
    >
      <p className="text-sm text-muted">
        One contact per line: <code>company, email, name, position</code> (name and position optional). Rows copied from a spreadsheet work too.
      </p>
      <textarea
        className="input font-mono text-xs"
        rows={6}
        required
        placeholder={'Acme, hr@acme.com, Priya Sharma, HR Manager\nBeta Labs, careers@betalabs.io'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={paste.isPending}>
          {paste.isPending ? 'Adding…' : 'Add all'}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Close
        </button>
        {paste.data && (
          <span className="text-sm text-muted">
            Added {paste.data.added}
            {paste.data.alreadyThere > 0 && `, ${paste.data.alreadyThere} already in your list`}
            {paste.data.skipped.length > 0 && `. Skipped lines: ${paste.data.skipped.map((s) => `${s.line} (${s.reason})`).join('; ')}`}
          </span>
        )}
        {paste.isError && <span className="text-sm text-danger">{paste.error.message}</span>}
      </div>
    </form>
  );
}
