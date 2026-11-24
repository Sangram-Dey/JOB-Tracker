import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Guide, Icon, Notice, PageHeader, Pager, Quota, timeAgo, toast, usePaged, goToSettings, Toggle } from '../components/ui.jsx';
import { TailorCard } from '../components/TailorCard.jsx';
import { MailAccount } from '../components/MailAccount.jsx';

const STEPS = [
  ['Find HR contacts', 'The table fills itself from your top jobs. Add more with Find more HR, Add contact or Paste a list.'],
  ['Tick the people to email', 'Tick rows, or the top box for the whole page. Up to 25 at a time.'],
  ['Let AI write', 'Write N emails drafts one email per person for that role, with your resume attached.'],
  ['Check each email', 'Open a row with Check to read it, edit it, and fix any warning.'],
  ['Send', 'Tick ready rows and press Send. They go out a little apart, from the Gmail you connected in Settings.'],
  ['Watch replies', 'Every sent email becomes a Tracker card; replies in Gmail move it forward.'],
];
const MAX_PICK = 25;

// One list for emailing HR: every HR contact with company, role, name and email. Tick one or many ->
// AI writes each email -> check them in the row -> tick and Send. Nothing is sent without your click.
const SOURCE = { 'job post': 'Job post', 'company site': 'Company site', hunter: 'Hunter', manual: 'Added by you' };
const FILTERS = [
  ['all', 'All'],
  ['new', 'Not written'],
  ['ready', 'Ready'],
  ['emailed', 'Already emailed'],
];

const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// Where a row stands: what the Status column says and which actions it allows.
function stateOf(c, repeatDays) {
  const m = c.mail;
  if (c.writing) return { key: 'writing', label: 'Writing…', tone: 'text-cobalt' };
  if (m?.status === 'queued') return { key: 'sending', label: 'Sending…', tone: 'text-cobalt' };
  const again = c.lastContactedAt && `Emailed before, on ${shortDate(c.lastContactedAt)}`;
  if (m && ['draft', 'approved'].includes(m.status)) return { key: 'ready', label: 'Ready', tone: 'text-ok', canSend: true, hint: again };
  if (m?.status === 'failed') return { key: 'ready', label: "Didn't send", tone: 'text-danger', canSend: true };
  // People you already emailed live in their own tab: waiting until they can be emailed again, then
  // available again, but only after you confirm (RepeatConfirm).
  if (m?.status === 'sent' && c.recent)
    return { key: 'emailed', label: `Sent ${timeAgo(m.sentAt)}`, tone: 'text-ok', hint: repeatDays && `Can email again ${shortDate(new Date(m.sentAt).getTime() + repeatDays * 86_400_000)}` };
  if (m?.status === 'sent') return { key: 'emailed', label: 'Can email again', tone: 'text-cobalt', hint: `Last emailed ${shortDate(m.sentAt)}`, canWrite: true };
  if (!c.sendable)
    return { key: 'none', label: c.email ? 'Unverified email' : 'No email', tone: 'text-faint', hint: c.email ? 'Not sent to: it may bounce' : 'Find their email to write' };
  return { key: 'new', label: 'Not written', tone: 'text-muted', canWrite: true };
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
  const [repeat, setRepeat] = useState(null); // { action, list, go }: waiting for your OK to email people again
  // Writing or sending to anyone you emailed before asks first (the server also refuses without the OK).
  const guard = (action, list, go) => (list.some((c) => c.lastContactedAt) ? setRepeat({ action, list, go }) : go(list, false));

  const discover = useMutation({
    mutationFn: () => api('/contacts/discover', { method: 'POST' }),
    onSuccess: refresh,
    meta: { success: (d) => `Checked ${d.checked} company sites: ${d.found ? `${d.found} new contacts added` : 'no new contacts this time'}` },
  });
  const prepare = useMutation({
    mutationFn: () => api('/outreach/prepare', { method: 'POST' }),
    onSuccess: (d) => (refresh(), d.writing === 0 && toast('No new contacts to write to right now. Find more HR or add some.', 'info')),
    meta: { success: (d) => d.writing > 0 && `Writing ${d.writing} emails. They show as Ready when done.` },
  });
  const remove = useMutation({ mutationFn: (id) => api(`/contacts/${id}`, { method: 'DELETE' }), onSuccess: refresh, meta: { success: 'Contact deleted' } });
  const write = useMutation({
    mutationFn: ({ ids, confirmRepeat }) => api('/outreach/drafts', { method: 'POST', body: { contactIds: ids, confirmRepeat } }),
    onSuccess: () => (setSelected([]), refresh()),
    meta: { success: (d) => d.writing > 0 && `AI is writing ${d.writing} ${d.writing === 1 ? 'email' : 'emails'}. Rows turn Ready when done.` },
  });
  const send = useMutation({
    mutationFn: ({ ids, confirmRepeat }) => api('/outreach/send', { method: 'POST', body: { ids, approve: true, confirmRepeat } }),
    onSuccess: () => (setSelected([]), refresh()),
    meta: { success: (d) => d.queued > 0 && `${d.queued} ${d.queued === 1 ? 'email is' : 'emails are'} sending, a little apart. Each becomes a Tracker card.` },
  });

  const s = status.data;
  const all = contacts.data?.items ?? [];
  const q = query.trim().toLowerCase();
  const rows = all.filter(
    (c) =>
      (!onlyActive || c.jobs.length || c.source === 'manual' || c.mail) &&
      // "All" is your to-do list: people you already emailed are only in "Already emailed"
      (filter === 'all' ? stateOf(c, s?.repeatDays).key !== 'emailed' : stateOf(c, s?.repeatDays).key === filter) &&
      (!q || `${c.company} ${c.name ?? ''} ${c.email ?? ''} ${c.position ?? ''} ${c.jobs[0]?.title ?? ''}`.toLowerCase().includes(q)),
  );
  const chosen = all.filter((c) => selected.includes(c._id));
  const toWrite = chosen.filter((c) => stateOf(c, s?.repeatDays).canWrite);
  const toSend = chosen.filter((c) => stateOf(c, s?.repeatDays).canSend);
  const { visible, pager } = usePaged(rows);
  const pagePickable = visible.filter((c) => stateOf(c, s?.repeatDays).canWrite || stateOf(c, s?.repeatDays).canSend);
  const allSelected = pagePickable.length > 0 && pagePickable.every((c) => selected.includes(c._id));
  const toggle = (id) => {
    if (selected.includes(id)) return setSelected(selected.filter((x) => x !== id));
    if (selected.length >= MAX_PICK) return toast(`Up to ${MAX_PICK} at a time. Write or send these first.`, 'warning');
    setSelected([...selected, id]);
  };
  const selectPage = () => {
    if (allSelected) return setSelected(selected.filter((id) => !pagePickable.some((c) => c._id === id)));
    const add = pagePickable.map((c) => c._id).filter((id) => !selected.includes(id));
    const room = MAX_PICK - selected.length;
    if (add.length > room) toast(`Selected the first ${room}: up to ${MAX_PICK} at a time.`, 'warning');
    setSelected([...selected, ...add.slice(0, Math.max(0, room))]);
  };
  const count = (key) => all.filter((c) => stateOf(c, s?.repeatDays).key === key).length;
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
        Email HR people directly at companies with jobs that fit you. AI writes each email; nothing is sent until you press Send.
      </PageHeader>

      {noPdf && (
        <Notice tone="warning" action={<button className="btn-outline" onClick={() => onNavigate('profile')}>Go to Settings</button>}>
          <strong className="font-semibold">Upload your resume PDF first.</strong> Every email attaches it, so none can be written until then.
        </Notice>
      )}
      {s && !s.gmail && <MailAccount compact onNavigate={onNavigate} />}
      {s?.sentLast24h >= s?.dailyLimit && (
        <Notice tone="error">
          <strong className="font-semibold">Daily limit reached ({s.dailyLimit} emails).</strong> You can still write and check emails; sending opens up again as the
          oldest of today's emails passes 24 hours.
        </Notice>
      )}
      {send.data?.skipped.length > 0 && (
        <Notice tone="warning" onClose={send.reset}>
          <strong className="font-semibold">{send.data.skipped.length} held back:</strong> {send.data.skipped.map((x) => `${x.to} (${x.reason})`).join('; ')}
        </Notice>
      )}
      {write.data?.skipped.length > 0 && (
        <Notice tone="warning" onClose={write.reset}>
          <strong className="font-semibold">Not written:</strong> {write.data.skipped.map((x) => `${x.contact} (${x.reason})`).join('; ')}
        </Notice>
      )}
      {s?.lastPrepared?.skipped?.length > 0 && !s.preparing && (
        <Notice tone="info">Last automatic run skipped: {s.lastPrepared.skipped.map((x) => `${x.contact} (${x.reason})`).join('; ')}</Notice>
      )}
      {contacts.data?.finding && <Notice tone="info">Looking for more HR contacts on your top jobs' posts and company websites…</Notice>}

      {s?.from && (
        <Notice tone="success" action={<button className="btn-outline" onClick={() => goToSettings(onNavigate, 'email')}>Test or change</button>}>
          Sending from <strong className="font-semibold">{s.from}</strong>. Replies to it update your Tracker.
        </Notice>
      )}
      {s && (
        <div className="mb-5 grid items-start gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Quota
              id="email-quota"
              label="Emails sent in the last 24 hours"
              used={s.sentLast24h}
              limit={s.dailyLimit}
              goal={s.dailyGoal}
              note={`Goal ${s.dailyGoal} a day (the mark on the bar). Rules: one email per company per day, and no repeat to the same person within ${s.repeatDays} days.`}
            />
          </div>
          <Stat label="Ready to send" value={count('ready')} note={s.preparing ? 'AI is writing more…' : `Streak: ${s.streak} ${s.streak === 1 ? 'day' : 'days'} in a row`} />
        </div>
      )}
      <Guide id="email" title="How emailing HR works" steps={STEPS} />
      {/* toolbar: what to show (tabs, search, filter) on top, ways to add contacts below */}
      <section className="panel-controls mb-3 p-3" aria-label="Filters">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
            <div className="inline-flex rounded-lg border border-line bg-surface p-1" role="tablist" aria-label="Show">
              {FILTERS.map(([key, label]) => {
                const active = filter === key;
                return (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(key)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition ${active ? 'bg-cobalt font-semibold text-on-accent shadow-sm' : 'text-muted hover:bg-sunken hover:text-ink'}`}
                  >
                    {label}
                    {contacts.data && (
                      <span className={`rounded-full px-1.5 text-xs font-medium tabular-nums ${active ? 'bg-on-accent/20' : 'bg-sunken text-muted'}`}>
                        {key === 'all' ? all.filter((c) => stateOf(c, s?.repeatDays).key !== 'emailed').length : count(key)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search contacts</span>
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Search company, role, name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center">
          <Toggle checked={onlyActive} onChange={setOnlyActive} label="Only companies with active jobs" hint="Hides contacts whose company has no open job that fits you" />
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <button className="btn-outline" onClick={() => setPanel(panel === 'add' ? null : 'add')} aria-expanded={panel === 'add'}>
              <Icon name="plus" />
              Add contact
            </button>
            <button className="btn-outline" onClick={() => setPanel(panel === 'paste' ? null : 'paste')} aria-expanded={panel === 'paste'}>
              <Icon name="list" />
              Paste a list
            </button>
            <button className="btn-outline" onClick={() => discover.mutate()} disabled={discover.isPending}>
              <Icon name="search" />
              {discover.isPending ? 'Finding…' : 'Find more HR'}
            </button>
          </div>
        </div>
      </section>
      {filter === 'emailed' && (
        <Notice tone="info">
          <strong className="font-semibold">People you've already emailed.</strong> They're kept apart so nobody gets a second email by accident. After{' '}
          {s?.repeatDays ?? 14} days a row shows <em>Can email again</em>; writing to them again asks you to confirm first.
        </Notice>
      )}
      {panel === 'add' && <AddContact onDone={() => (setPanel(null), refresh())} />}
      {panel === 'paste' && <PasteList onDone={refresh} onClose={() => setPanel(null)} />}
      {contacts.data && <HunterBox status={contacts.data.hunter} onFound={refresh} />}

      {contacts.isPending && <TableSkeleton />}
      {contacts.isError && <Notice tone="error">Couldn't load your contacts: {contacts.error.message}. Reload the page to try again.</Notice>}
      {contacts.data && !rows.length && (
        <div className="panel px-6 py-14 text-center">
          <p className="text-lg font-semibold tracking-tight">{all.length ? 'Nothing matches this filter' : 'Find your first HR contacts'}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            {all.length ? 'Pick another filter above or clear the search box.' : 'Press Find more HR, look one up on Hunter, or add or paste ones you found.'}
          </p>
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
                    aria-label="Select everyone shown"
                    title="Select everyone shown"
                    checked={allSelected}
                    disabled={!pagePickable.length}
                    onChange={selectPage}
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
              {visible.map((c) => {
                const st = stateOf(c, s?.repeatDays);
                const canPick = st.canWrite || st.canSend;
                const isOpen = openRow === c._id && c.mail;
                return (
                  <Fragment key={c._id}>
                    <tr className={`fade-in transition-colors ${selected.includes(c._id) ? 'bg-cobalt-soft/50' : 'hover:bg-sunken/50'}`}>
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
                      <td className="px-2 py-2.5 align-top text-xs">
                        <p className={`font-semibold ${st.tone}`}>{st.label}</p>
                        {st.hint && <p className="mt-0.5 text-faint">{st.hint}</p>}
                      </td>
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
      <Pager {...pager} noun="contacts" />


      {repeat && <RepeatConfirm repeat={repeat} onClose={() => setRepeat(null)} />}

      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl [animation:fade-up_200ms_ease-out] lg:left-64">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <span className="text-sm font-semibold">
              {selected.length} of {MAX_PICK} selected
            </span>
            <span className="text-xs text-muted">
              {toWrite.length > 0 && `${toWrite.length} to write · `}
              {toSend.length > 0 && `${toSend.length} ready to send · `}
              {s && `${Math.max(0, s.dailyLimit - s.sentLast24h)} sends left today`}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setSelected([])}>
                Clear
              </button>
              {toWrite.length > 0 && (
                <button className="btn-outline" disabled={write.isPending || s?.preparing || noPdf} onClick={() => guard('write', toWrite, (list, confirmRepeat) => write.mutate({ ids: list.map((c) => c._id), confirmRepeat }))}>
                  <Icon name="sparkle" />
                  Write {toWrite.length} {toWrite.length === 1 ? 'email' : 'emails'}
                </button>
              )}
              {toSend.length > 0 && (
                <button className="btn" disabled={send.isPending || !s?.gmail} title={s?.gmail ? undefined : 'Connect your apply email in Settings first'} onClick={() => guard('send', toSend, (list, confirmRepeat) => send.mutate({ ids: list.map((c) => c.mail._id), confirmRepeat }))}>
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

function TableSkeleton() {
  return (
    <div className="panel divide-y divide-line" aria-label="Loading contacts">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-4 px-4 py-3.5">
          <div className="h-4 w-4 animate-pulse rounded bg-sunken" />
          <div className="h-4 w-1/5 animate-pulse rounded bg-sunken" />
          <div className="h-4 w-1/4 animate-pulse rounded bg-sunken" />
          <div className="h-4 w-1/5 animate-pulse rounded bg-sunken" />
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="panel-status px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
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
  const useOwn = useMutation({
    meta: { inline: true, success: (r) => (r.useOriginal ? 'Your own resume PDF will be attached' : 'The tailored resume will be attached') },
    mutationFn: (useOriginal) => api(`/outreach/${mail._id}/resume`, { method: 'PUT', body: { useOriginal } }),
    onSuccess: onChange,
  });
  // Regenerate: AI writes it again in different words; optionally with what to change
  const [wish, setWish] = useState('');
  const [asking, setAsking] = useState(false);
  const regenerate = useMutation({
    meta: { success: 'New version written' },
    mutationFn: (instruction) => api(`/outreach/${mail._id}/regenerate`, { method: 'POST', body: { instruction } }),
    onSuccess: () => (setAsking(false), setWish(''), onChange()),
  });
  const error = save.error ?? discard.error ?? useOwn.error ?? regenerate.error;

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
      ) : regenerate.isPending ? (
        <div className="ai-working space-y-2 rounded-xl p-4" role="status">
          <p className="flex items-center gap-2 font-semibold text-cobalt">
            <Icon name="sparkle" className="size-4 animate-pulse text-pink" /> AI is rewriting this email…
          </p>
          <div className="skeleton h-3 w-11/12" />
          <div className="skeleton h-3 w-10/12" />
          <div className="skeleton h-3 w-8/12" />
          <p className="text-xs text-faint">Usually 5–15 seconds; if Gemini is busy it waits and tries once more.</p>
        </div>
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
      {mail.jobId ? (
        editable ? (
          <TailorCard jobId={mail.jobId} useOriginal={mail.useOriginal} onUseOriginal={(useOriginal) => useOwn.mutate(useOriginal)} sendLabel="attached" />
        ) : (
          <p className="text-xs text-muted">{mail.resumePdfId ? 'Sent with a resume tailored to this job.' : 'Sent with your resume PDF.'}</p>
        )
      ) : (
        <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-muted">No job is linked to this contact, so there's no description to tailor to: your main resume PDF is attached.</p>
      )}
      {mail.status === 'failed' && <p className="text-xs text-danger">Didn't send: {mail.error}</p>}
      {error && <p className="text-danger">{error.issues?.[0]?.message ?? error.message}</p>}
      {editable && asking && !regenerate.isPending && (
        <div className="pop-in flex flex-wrap gap-2 rounded-lg border border-line bg-paper p-3">
          <input
            className="input min-w-48 flex-1"
            value={wish}
            maxLength={200}
            autoFocus
            onChange={(e) => setWish(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && wish.trim() && regenerate.mutate(wish.trim())}
            placeholder="What to change, e.g. “shorter” or “mention my React projects”"
          />
          <button className="btn" onClick={() => regenerate.mutate(wish.trim())} disabled={!wish.trim()}>
            <Icon name="sparkle" /> Rewrite
          </button>
        </div>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <button className="btn" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
          )}
          <button className="btn-outline" onClick={() => regenerate.mutate('')} disabled={regenerate.isPending || dirty} title={dirty ? 'Save or discard your edits first' : 'A new version in different words'}>
            <Icon name="undo" className="size-4 -scale-x-100" />
            {regenerate.isPending ? 'Rewriting…' : 'Regenerate'}
          </button>
          <button className="btn-ghost" onClick={() => setAsking(!asking)} disabled={regenerate.isPending || dirty} aria-expanded={asking}>
            <Icon name="sparkle" />
            Change with instructions
          </button>
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

function HunterBox({ status, onFound }) {
  const [form, setForm] = useState({ domain: '', company: '' });
  const look = useMutation({ meta: { inline: true }, mutationFn: () => api('/contacts/hunter', { method: 'POST', body: form }), onSuccess: onFound });
  if (!status.configured) return null; // optional (HUNTER_API_KEY on the server): nothing to show without it
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
  const add = useMutation({ meta: { inline: true }, mutationFn: () => api('/contacts', { method: 'POST', body: form }), onSuccess: onDone });
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
  const paste = useMutation({ meta: { inline: true }, mutationFn: () => api('/contacts/import', { method: 'POST', body: { text } }), onSuccess: (r) => (r.added && setText(''), onDone()) });
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

// "You emailed these people before": shown before writing or sending to anyone who already got an email from you.
function RepeatConfirm({ repeat, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const { action, list, go } = repeat;
  const again = list.filter((c) => c.lastContactedAt);
  const others = list.filter((c) => !c.lastContactedAt);
  const run = (people, confirmRepeat) => (go(people, confirmRepeat), ref.current?.close());
  return (
    <dialog ref={ref} className="dialog w-[min(32rem,calc(100%-2rem))]" onClose={onClose} aria-labelledby="repeat-title">
      <h2 id="repeat-title" className="section-title">
        Email {again.length === 1 ? 'this person' : `these ${again.length} people`} again?
      </h2>
      <p className="section-desc">You already emailed them. A second email is fine when you have something new to say, like a new role or a follow-up.</p>
      <ul className="mt-4 max-h-60 space-y-2 overflow-y-auto">
        {again.map((c) => (
          <li key={c._id} className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
            <p className="font-semibold">{c.company}</p>
            <p className="text-muted">
              {c.name ? `${c.name} · ` : ''}
              {c.email}
            </p>
            <p className="text-xs text-faint">Last emailed {shortDate(c.lastContactedAt)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button type="button" className="btn-ghost" onClick={() => ref.current?.close()}>
          Cancel
        </button>
        {others.length > 0 && (
          <button type="button" className="btn-outline" onClick={() => run(others, false)}>
            Only the {others.length} new
          </button>
        )}
        <button type="button" className="btn" onClick={() => run(list, true)}>
          {action === 'write' ? 'Write' : 'Send'} {others.length ? `all ${list.length}` : 'again'}
        </button>
      </div>
    </dialog>
  );
}
