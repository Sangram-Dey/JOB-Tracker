import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Guide, Icon, Notice, PAGE_SIZE, PageHeader, Pager, Quota, timeAgo, toast, untilText, Collapsible, Toggle } from '../components/ui.jsx';
import { JobAtsCheck } from '../components/AtsCheck.jsx';
import { TailorCard } from '../components/TailorCard.jsx';
import { ApplyQueue, APPLY_STATUS } from '../components/AutoApply.jsx';

const MODE_LABEL = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', unknown: 'Mode not given' };
const SOURCE_LABEL = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  freehire: 'freehire',
  jsearch: 'JSearch',
  apify: 'Apify',
  remotive: 'Remotive',
  remoteok: 'Remote OK',
  himalayas: 'Himalayas',
  weworkremotely: 'We Work Remotely',
};
const PLATFORM = { naukri: 'Naukri', indeed: 'Indeed', linkedin: 'LinkedIn' };
const MOVED = { saved: 'saved', hidden: 'hidden', new: 'moved back to New' };
const TABS = [
  ['new', 'New'],
  ['saved', 'Saved'],
  ['hidden', 'Hidden'],
];
const FRESH_MS = 86_400_000;
const MAX_PICK = 50; // jobs ticked at once, for any bulk action
const MAX_PREPARE = 20; // auto-apply forms prepared in one go (the server's limit)
const STEPS = [
  ['Find jobs that fit', 'New matches arrive on their own. Sort by Best fit and open a job to read why it fits.'],
  ['Tick the jobs you want', 'Every job has a checkbox. Tick several, or "Select all shown" (up to 50).'],
  ['Auto-apply where it can', 'Auto-apply fills Greenhouse, Lever and Ashby forms for you. They wait in the review box above.'],
  ['Review, then Submit', 'Open each filled form, answer anything marked "to answer", then press Submit.'],
  ['Apply on other sites yourself', 'For Naukri, Indeed and others: open the job, apply there, then press Mark applied.'],
  ['Keep the list tidy', 'Save the ones you like, hide the rest. Everything you apply to shows in the Tracker.'],
];
const canAuto = (m) => m.ats && !['applied', 'preparing', 'submitting'].includes(m.application?.status);

export default function JobsPage({ onNavigate }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('new');
  const [workMode, setWorkMode] = useState('');
  const [q, setQ] = useState(''); // applied search text
  const [draftQ, setDraftQ] = useState(''); // what's typed in the box
  const [sort, setSort] = useState('fit');
  const [autoOnly, setAutoOnly] = useState(false); // only jobs auto-apply can fill
  const [all, setAll] = useState(false); // "Show all jobs found": ignore pay, age, experience and platform settings
  const [foundToday, setFoundToday] = useState(false); // only matches from the last 24 hours
  const [extra, setExtra] = useState(0); // rows added by "Load more"

  const params = new URLSearchParams({
    status,
    sort,
    limit: PAGE_SIZE + extra,
    ...(q && { q }),
    ...(workMode && { workMode }),
    ...(all && { all: '1' }),
    ...(autoOnly && { autoApply: '1' }),
    ...(foundToday && { found: 'today' }),
  });
  const jobs = useQuery({
    queryKey: ['jobs', status, q, workMode, sort, extra, all, autoOnly, foundToday],
    queryFn: () => api(`/jobs?${params}`),
    placeholderData: (prev) => prev, // keep rows on screen while the next page or batch loads
  });
  // shared with the Auto-apply box: today's count against the daily limit
  const queue = useQuery({ queryKey: ['applyQueue'], queryFn: () => api('/apply/queue') });
  // auto-apply uploads this PDF to every form; without it the server refuses to prepare
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api('/profile') });
  const noPdf = profile.data && !profile.data.resumePdf?.id;
  const left = queue.data ? Math.max(0, queue.data.dailyLimit - queue.data.today) : MAX_PREPARE;
  // { run, running, error }: checked every few seconds while a background search runs
  const lastRun = useQuery({ queryKey: ['lastRun'], queryFn: () => api('/jobs/runs/latest'), refetchInterval: (q) => (q.state.data?.running ? 4000 : false) });

  // Saved jobs show at once from the database; opening (or reloading) the page also checks the free job boards in the
  // background if the last search is over an hour old. Paid sources (Naukri, Indeed, JSearch) run only every 6 hours.
  useEffect(() => {
    api('/jobs/refresh', { method: 'POST' })
      .then((r) => r.started && queryClient.invalidateQueries({ queryKey: ['lastRun'] }))
      .catch(() => {}); // the Refresh button still works and shows its own errors
  }, [queryClient]);
  // A finished search (new run id) brings new jobs: reload the list.
  const runId = lastRun.data?.run?._id;
  const seenRun = useRef(runId);
  useEffect(() => {
    if (seenRun.current && runId !== seenRun.current) queryClient.invalidateQueries({ queryKey: ['jobs'] });
    seenRun.current = runId;
  }, [runId, queryClient]);

  const search = useMutation({
    meta: { success: 'Checking the free job boards. New jobs appear here when it finishes.' },
    mutationFn: () => api('/jobs/search', { method: 'POST' }),
    onSuccess: (run) => queryClient.setQueryData(['lastRun'], { run, running: false, error: null }),
  });
  const searching = search.isPending || lastRun.data?.running;

  // Ticked jobs, kept across pages. Whole matches, so bulk actions know titles and links.
  const [picked, setPicked] = useState([]);
  const isPicked = (m) => picked.some((p) => p._id === m._id);
  const pick = (m) => {
    if (isPicked(m)) return setPicked(picked.filter((p) => p._id !== m._id));
    if (picked.length >= MAX_PICK) return toast(`Up to ${MAX_PICK} jobs at a time. Act on these first.`, 'warning');
    setPicked([...picked, m]);
  };
  const rows = jobs.data?.items ?? [];
  const pageAllPicked = rows.length > 0 && rows.every(isPicked);
  const pickPage = () => {
    if (pageAllPicked) return setPicked(picked.filter((p) => !rows.some((m) => m._id === p._id)));
    const add = rows.filter((m) => !isPicked(m)).slice(0, MAX_PICK - picked.length);
    if (add.length < rows.filter((m) => !isPicked(m)).length) toast(`Selected ${add.length}: up to ${MAX_PICK} jobs at a time.`, 'warning');
    setPicked([...picked, ...add]);
  };
  const autoPicked = picked.filter(canAuto);
  const autoCount = Math.min(autoPicked.length, MAX_PREPARE, left);

  const done = () => {
    setPicked([]);
    ['jobs', 'applyQueue', 'tracker', 'today'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  };
  const prepare = useMutation({
    meta: { success: (d) => d.queued > 0 && `Preparing ${d.queued} ${d.queued === 1 ? 'application' : 'applications'}. Follow each one in the Auto-apply review box.` },
    mutationFn: () => api('/apply/prepare', { method: 'POST', body: { matchIds: autoPicked.slice(0, autoCount).map((m) => m._id) } }),
    onSuccess: () => {
      const rest = picked.length - autoCount;
      if (rest > 0) toast(`${rest} other ${rest === 1 ? 'job stays' : 'jobs stay'} ticked: apply on the job site, then press Mark applied.`, 'info');
      setPicked(picked.filter((m) => !autoPicked.slice(0, autoCount).includes(m)));
      ['jobs', 'applyQueue'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      setTimeout(() => document.getElementById('auto-apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    },
  });
  // Bulk save / hide / mark applied: one request per job, all at once.
  const bulk = useMutation({
    mutationFn: ({ action }) =>
      Promise.all(
        picked.map((m) =>
          action === 'applied'
            ? api('/tracker', { method: 'POST', body: { jobId: m.job._id, company: m.job.company, role: m.job.title, url: m.job.applyUrl || m.job.url } })
            : api(`/jobs/${m._id}`, { method: 'PATCH', body: { status: action } }),
        ),
      ),
    onSuccess: done,
    meta: { success: (r, { action }) => `${r.length} ${r.length === 1 ? 'job' : 'jobs'} ${action === 'applied' ? 'marked applied and added to your Tracker' : MOVED[action]}` },
  });
  const move = useMutation({
    mutationFn: ({ id, status }) => api(`/jobs/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: (_d, { id, status: to, from, title }) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      if (from) toast(`${title}: ${MOVED[to]}`, 'success', { label: 'Undo', run: () => move.mutate({ id, status: from }) });
    },
  });

  const filter = (fn) => (...args) => {
    fn(...args);
    setExtra(0);
  };
  const filtered = q || workMode || autoOnly || foundToday;

  return (
    <div>
      <PageHeader
        title="Jobs"
        actions={
          <button className="btn" onClick={() => search.mutate()} disabled={searching} title="Checks the free job boards now. Naukri, Indeed and JSearch update automatically every 6 hours.">
            <Icon name="search" />
            {searching ? 'Refreshing…' : 'Refresh jobs'}
          </button>
        }
      >
        Jobs that match your roles, places and skills, scored by AI. Tick the ones you want and apply in one go.
      </PageHeader>

      {noPdf && (
        <Notice tone="error" action={<button className="btn-outline" onClick={() => onNavigate('profile')}>Go to Settings</button>}>
          <strong className="font-semibold">Auto-apply is off: no resume PDF.</strong> Every application form needs your resume, so upload your PDF in Settings
          first. Until then you can still tick jobs to save, hide or mark them applied.
        </Notice>
      )}
      {lastRun.data?.error && <Notice tone="warning">The last automatic search had a problem: {lastRun.data.error}</Notice>}
      {prepare.data?.skipped.length > 0 && (
        <Notice tone="warning" onClose={prepare.reset}>
          <strong className="font-semibold">Not prepared:</strong> {prepare.data.skipped.map((x) => `${x.job} (${x.reason})`).join('; ')}
        </Notice>
      )}

      <Today onNavigate={onNavigate} onNewToday={() => (filter(setFoundToday)(true), filter(setStatus)('new'))} />

      <div className="mb-5 grid items-start gap-3 lg:grid-cols-2">
        <Collapsible
          id="jobs-last-update"
          icon="search"
          title="Last update"
          summary={
            searching ? (
              <span className="animate-pulse font-medium text-cobalt">checking job boards…</span>
            ) : lastRun.data?.run ? (
              `${timeAgo(lastRun.data.run.createdAt)} · ${lastRun.data.run.newMatches} new for you`
            ) : (
              'no search yet'
            )
          }
        >
          {lastRun.data?.run ? (
            <RunSummary run={lastRun.data.run} onNavigate={onNavigate} />
          ) : (
            <p className="text-muted">No search yet. Press Refresh jobs for the free job boards; Naukri, Indeed and JSearch arrive with the automatic update.</p>
          )}
          <p className="mt-1.5 text-xs text-muted">
            <span className="font-medium text-ink">Naukri, Indeed and JSearch:</span> automatic, every 6 hours
            {lastRun.data?.nextScheduled ? ` · next after ${clock(lastRun.data.nextScheduled)}` : ' · next within half an hour'}
          </p>
        </Collapsible>
        {queue.data && (
          <Quota
            id="jobs-apply-quota"
            label="Auto-apply submissions today"
            used={queue.data.today}
            limit={queue.data.dailyLimit}
            note={
              left
                ? `${left} left. Only Submit counts; preparing and reviewing are free.`
                : `Limit reached. The next slot opens ${untilText(queue.data.freesAt ?? Date.now() + 86_400_000)}; you can still prepare and review.`
            }
          />
        )}
      </div>

      <Guide id="jobs" title="How applying works" steps={STEPS} />
      <ApplyQueue onChange={() => queryClient.invalidateQueries({ queryKey: ['jobs'] })} />

      {/* Filters */}
      <section className="panel-controls mb-3 flex flex-wrap items-center gap-3 p-3" aria-label="Filters">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Show">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={status === value}
              onClick={() => filter(setStatus)(value)}
              className={`rounded-md px-3 py-1 text-sm transition ${status === value ? 'bg-cobalt font-semibold text-on-accent shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="relative min-w-48 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            filter(setQ)(draftQ.trim());
          }}
        >
          <label>
            <span className="sr-only">Search title, company or place</span>
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Search title, company or place, then Enter" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} />
          </label>
        </form>
        <label>
          <span className="sr-only">Work mode</span>
          <select className="input w-auto" value={workMode} onChange={(e) => filter(setWorkMode)(e.target.value)}>
            <option value="">Any work mode</option>
            {Object.entries(MODE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort by</span>
          <select className="input w-auto" value={sort} onChange={(e) => filter(setSort)(e.target.value)}>
            <option value="fit">Sort: Best fit</option>
            <option value="posted">Sort: Newest posted</option>
            <option value="pay">Sort: Highest pay</option>
            <option value="found">Sort: Recently found</option>
          </select>
        </label>
        <div className="flex w-full flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3 text-sm">
          <Toggle checked={autoOnly} onChange={filter(setAutoOnly)} label="Auto-apply jobs only" hint="Greenhouse, Lever and Ashby: the app fills these forms" />
          <Toggle checked={foundToday} onChange={filter(setFoundToday)} label="Found today" hint="Matches from the last 24 hours" />
          <Toggle checked={all} onChange={filter(setAll)} label="Show all jobs found" hint="Includes jobs your pay, experience, date or platform settings hide" />
        </div>
      </section>

      {(jobs.data?.hiddenByPreferences > 0 || jobs.data?.closedOrJunk > 0) && (
        <p className="mb-3 text-sm text-muted">
          {jobs.data.closedOrJunk > 0 && `${jobs.data.closedOrJunk} hidden because they're closed or look like junk. `}
          {jobs.data.hiddenByPreferences > 0 && (
            <>
              {jobs.data.hiddenByPreferences} hidden by your pay, experience, date or platform settings.{' '}
              <button className="font-semibold text-cobalt hover:underline" onClick={() => filter(setAll)(true)}>
                Show them
              </button>
              {' · '}
              <button className="font-semibold text-cobalt hover:underline" onClick={() => onNavigate('preferences')}>
                Change preferences
              </button>
            </>
          )}
        </p>
      )}
      {jobs.isPending && <ListSkeleton />}
      {/* shows as soon as one job is ticked, and stays in view while you scroll */}
      {picked.length > 0 && (
        <div className="fade-in sticky top-2 z-20 mb-3 rounded-xl border border-cobalt/40 bg-surface px-4 py-3 shadow-lg" role="region" aria-label="Selected jobs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="text-sm">
              <p className="font-semibold">
                {picked.length} {picked.length === 1 ? 'job' : 'jobs'} selected
              </p>
              <p className="text-xs text-muted">
                {autoPicked.length} can be auto-applied
                {autoPicked.length > autoCount && ` (${autoCount} now: ${left < MAX_PREPARE ? `${left} left today` : `${MAX_PREPARE} at a time`})`} · {picked.length - autoPicked.length} apply on the job site
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setPicked([])}>
                Clear
              </button>
              <button className="btn-outline" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'hidden' })} title="Move them to Hidden">
                <Icon name="hide" />
                Hide
              </button>
              <button className="btn-outline" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'saved' })} title="Keep them in Saved">
                <Icon name="bookmark" />
                Save
              </button>
              <button className="btn-outline" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'applied' })} title="You applied on the job site: add them to your Tracker">
                <Icon name="check" />
                Mark applied
              </button>
              <button
                className="btn"
                disabled={prepare.isPending || !autoCount || noPdf}
                onClick={() => prepare.mutate()}
                title={
                  noPdf
                    ? 'Upload your resume PDF in Settings first'
                    : autoCount
                      ? 'AI fills each form; you review before anything is submitted'
                      : 'None of these are on Greenhouse, Lever or Ashby, or today’s limit is used'
                }
              >
                <Icon name="sparkle" />
                {prepare.isPending ? 'Starting…' : autoCount ? `Auto-apply ${autoCount}` : 'Auto-apply'}
              </button>
            </div>
          </div>
        </div>
      )}
      {jobs.isError && <Notice tone="error">Couldn't load jobs: {jobs.error.message}. Reload the page to try again.</Notice>}
      {jobs.data?.items.length === 0 && <EmptyState status={status} filtered={filtered} onNavigate={onNavigate} onSearch={() => search.mutate()} searching={searching} />}
      {rows.length > 0 && (
        <div className="panel overflow-hidden">
          <label className="flex cursor-pointer items-center gap-3 border-b border-line bg-sunken/50 px-5 py-2.5 text-sm">
            <input type="checkbox" className="size-4 accent-cobalt" checked={pageAllPicked} onChange={pickPage} />
            <span className="font-semibold">Select all shown</span>
            <span className="ml-auto text-xs text-muted">{jobs.data.total} jobs</span>
          </label>
          <ul className={`divide-y divide-line transition-opacity ${jobs.isPlaceholderData ? 'opacity-60' : ''}`}>
            {rows.map((m) => (
              <JobRow
                key={m._id}
                match={m}
                onMove={(to) => move.mutate({ id: m._id, status: to, from: m.status, title: m.job.title })}
                busy={move.isPending}
                picked={isPicked(m)}
                onPick={() => pick(m)}
              />
            ))}
          </ul>
        </div>
      )}

      {jobs.data && (
        <Pager count={rows.length} total={jobs.data.total} onMore={jobs.data.hasMore ? () => setExtra(extra + PAGE_SIZE) : null} loading={jobs.isFetching} noun="jobs" />
      )}

    </div>
  );
}


const clock = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const BY = { manual: 'by you', auto: 'on opening', schedule: 'automatic, all sources' };

function RunSummary({ run, onNavigate }) {
  const failed = run.boards.filter((b) => b.error);
  const found = run.boards.reduce((n, b) => n + b.fetched, 0);
  const waiting = (run.skipped ?? []).filter((s) => s.until && new Date(s.until) > Date.now());
  return (
    <div className="text-muted">
      <p>
        {timeAgo(run.createdAt)} ({BY[run.trigger] ?? run.trigger}): looked at {found} jobs, <strong className="font-semibold text-ink">{run.newMatches} new for you</strong>.
        {run.liveness?.checked > 0 && ` ${run.liveness.closed} of ${run.liveness.checked} checked postings had closed.`}
      </p>
      {run.terms?.length > 0 && (
        <p className="mt-0.5 text-xs">
          Searched for {run.terms.join(', ')}
          {run.termsFrom === 'profile' && (
            <>
              {' '}
              (from your resume;{' '}
              <button className="font-semibold text-cobalt hover:underline" onClick={() => onNavigate('preferences')}>
                set your own
              </button>
              )
            </>
          )}
        </p>
      )}
      {waiting.length > 0 && (
        <p className="mt-0.5 text-xs" title="Each free job board is checked at most once an hour, so clicking Refresh again is harmless.">
          Checked recently, so skipped: {waiting.map((w) => `${SOURCE_LABEL[w.source] ?? w.source}${w.board ? ` (${w.board})` : ''} until ${clock(w.until)}`).join(', ')}
        </p>
      )}
      {failed.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer font-medium text-marigold">
            {failed.length} {failed.length === 1 ? 'source had a problem' : 'sources had problems'}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {failed.map((b) => (
              <li key={b.source + b.board}>
                {SOURCE_LABEL[b.source] ?? b.source} ({b.board}): {b.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EmptyState({ status, filtered, onNavigate, onSearch, searching }) {
  const text = filtered
    ? ['No jobs match these filters', 'Clear the search box or pick another work mode.']
    : status === 'saved'
      ? ['Nothing saved yet', 'Save jobs from the New tab to keep a shortlist here.']
      : status === 'hidden'
        ? ['Nothing hidden', 'Jobs you hide move here, out of your way.']
        : ['No new jobs yet', 'Upload your resume (or set role keywords and places), then search. New matches also arrive every six hours.'];
  return (
    <div className="panel px-6 py-14 text-center">
      <p className="text-xl font-semibold">{text[0]}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{text[1]}</p>
      {status === 'new' && !filtered && (
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-outline" onClick={() => onNavigate('preferences')}>
            Open preferences
          </button>
          <button className="btn" onClick={onSearch} disabled={searching}>
            {searching ? 'Refreshing…' : 'Refresh jobs'}
          </button>
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="panel divide-y divide-line" aria-label="Loading jobs">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="space-y-2 px-5 py-4">
          <div className="h-4 w-2/5 animate-pulse rounded bg-sunken" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-sunken" />
        </li>
      ))}
    </ul>
  );
}

// "₹12–18 LPA" for rupees; "$120k–150k a year" for other currencies, with a rough rupee figure.
const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
function formatPay({ min, max, currency, lpa }) {
  if (currency === 'INR') {
    const l = (n) => +(n / 100_000).toFixed(1);
    return l(min) === l(max) ? `₹${l(max)} LPA` : `₹${l(min)}–${l(max)} LPA`;
  }
  const k = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : n);
  const sym = SYMBOLS[currency] ?? `${currency} `;
  return `${sym}${min === max ? k(max) : `${k(min)}–${k(max)}`} a year (~₹${Math.round(lpa)} LPA)`;
}

function ModeChip({ mode }) {
  const tone =
    mode === 'remote' ? 'border-cobalt/30 text-cobalt' : mode === 'unknown' ? 'border-dashed border-line text-faint' : 'border-line text-muted';
  return <span className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${tone}`}>{MODE_LABEL[mode]}</span>;
}

function JobRow({ match, onMove, busy, picked, onPick }) {
  const appStatus = match.application?.status;
  const { job, status } = match;
  const [open, setOpen] = useState(false);
  const fresh = job.postedAt && Date.now() - new Date(job.postedAt) < FRESH_MS;
  const actions = {
    new: [
      ['saved', 'Save', 'bookmark'],
      ['hidden', 'Hide', 'hide'],
    ],
    saved: [['new', 'Remove from saved', 'undo']],
    hidden: [['new', 'Unhide', 'undo']],
  }[status];

  return (
    <li className={`fade-in transition-colors ${picked ? 'bg-cobalt-soft/50' : open ? 'bg-sunken/40' : 'hover:bg-sunken/30'}`}>
      <div className="flex gap-4 px-5 py-4">
        <span className="shrink-0 pt-3">
          <input type="checkbox" className="size-4 accent-cobalt" checked={picked} onChange={onPick} aria-label={`Select ${match.job.title}`} />
        </span>
        <FitBadge score={match.fit?.score} />
        <div className="min-w-0 flex-1">
          <button className="text-left font-medium leading-snug hover:text-cobalt" onClick={() => setOpen(!open)} aria-expanded={open}>
            {job.title}
          </button>
          <p className="mt-0.5 truncate text-sm text-muted">
            <span className="text-ink">{job.company}</span>
            {job.locations.length > 0 && <>, {job.locations.slice(0, 2).join('; ')}</>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
            <ModeChip mode={job.workMode} />
            {!match.ats && (
              <span
                className="rounded-md border border-line px-1.5 py-0.5 font-medium text-muted"
                title="The app doesn't fill forms on this site, to keep your accounts safe. Open the job, apply there, then press I applied here."
              >
                Apply on {job.via || PLATFORM[job.platform] || 'the job site'} yourself
              </span>
            )}
            {match.ats &&
              (appStatus ? (
                <span className={`font-medium ${APPLY_STATUS[appStatus][1]}`}>{APPLY_STATUS[appStatus][0]}</span>
              ) : (
                <span className="rounded-md bg-cobalt-soft px-1.5 py-0.5 font-semibold text-cobalt" title="Tick the box to let the app fill this job's application form">
                  Auto-apply
                </span>
              ))}
            {match.ai?.verdict && <VerdictChip ai={match.ai} />}
            {job.salary && (
              <span className="rounded-md bg-ok/10 px-1.5 py-0.5 font-medium text-ok" title={job.salary.fromText ? 'Read from the description' : 'Given by the job site'}>
                {formatPay(job.salary)}
              </span>
            )}
            {job.experienceMin != null && <span className="text-muted">{job.experienceMin}+ yrs</span>}
            {/* Attribution: the feeds' terms ask us to credit them. */}
            <span>
              via {SOURCE_LABEL[job.source] ?? job.source}
              {job.via && ` (${job.via})`}
            </span>
            {/* marigold only for jobs from the last day: the ones worth applying to first */}
            {job.postedAt && <span className={fresh ? 'font-medium text-marigold' : undefined}>Posted {timeAgo(job.postedAt)}</span>}
            {job.reposted && (
              <span className="text-marigold" title="The job site says this opening was listed again or bumped to look new">
                Reposted
              </span>
            )}
            {job.flags.length > 0 && (
              <span className="text-marigold" title={job.flags.join('\n')}>
                Contains text aimed at AI tools
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {actions.map(([to, label, icon]) => (
            <button key={to} className="btn-ghost px-2" disabled={busy} onClick={() => onMove(to)} aria-label={label} title={label}>
              <Icon name={icon} />
            </button>
          ))}
          <button className="btn-ghost px-2 text-pink" onClick={() => setOpen(true)} aria-label="Tailor resume for this job" title="Tailor resume for this job">
            <Icon name="sparkle" />
          </button>
          <button className="btn-ghost px-2" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Hide details' : 'Show details'}>
            <Icon name="chevron" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {open && <JobDetails matchId={match._id} />}
    </li>
  );
}

// Loaded only when opened: the list leaves out descriptions to stay small.
// Applied on the job page yourself: puts it on the Tracker board.
function AppliedHere({ job }) {
  const queryClient = useQueryClient();
  const add = useMutation({ meta: { inline: true },
    mutationFn: () => api('/tracker', { method: 'POST', body: { jobId: job._id, company: job.company, role: job.title, url: job.applyUrl || job.url } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tracker'] }),
  });
  if (add.isSuccess) return <p className="-mt-2 text-xs text-ok">On your Tracker board under Applied.</p>;
  return (
    <div className="-mt-2">
      <button className="btn-outline w-full" disabled={add.isPending} onClick={() => add.mutate()}>
        <Icon name="check" />
        I applied here
      </button>
      {add.isError && <p className="mt-1 text-xs text-danger">{add.error.message}</p>}
    </div>
  );
}

// What's waiting for you today, with a link to each place.
function Today({ onNavigate, onNewToday }) {
  const today = useQuery({ queryKey: ['today'], queryFn: () => api('/tracker/today') });
  const t = today.data;
  if (!t) return null;
  const items = [
    [t.newJobs, 'new jobs today', onNewToday, true, 'Show only jobs found in the last 24 hours'],
    [t.appsReady, 'applications to review', () => document.getElementById('auto-apply')?.scrollIntoView({ behavior: 'smooth' }), true, 'Go to the Auto-apply box'],
    [t.emailsReady, 'emails to send', () => onNavigate('email'), true, 'Open the Email page'],
    [t.newReplies, t.newReplies === 1 ? 'new reply' : 'new replies', () => onNavigate('tracker'), true, 'Open the Tracker'],
    [t.interviews, 'at interview', () => onNavigate('tracker'), false, 'Open the Tracker'],
    [t.appliedThisWeek, 'applied this week', () => onNavigate('tracker'), false, 'See your application history'],
  ];
  const line = items.filter(([n, , , highlight]) => highlight && n).map(([n, label]) => `${n} ${label}`).join(' · ') || 'nothing waiting for you';
  return (
    <Collapsible id="jobs-today" icon="tracker" title="Today" summary={line} className="mb-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([n, label, go, highlight, hint]) => (
        <button
          key={label}
          onClick={go}
          title={hint}
          className={`group rounded-xl border px-3 py-2.5 text-left transition hover:-translate-y-px hover:shadow-md ${
            highlight && n ? 'border-cobalt/30 bg-cobalt-soft' : 'border-line bg-surface hover:border-cobalt/40'
          }`}
        >
          <span className={`block text-2xl font-semibold ${highlight && n ? 'text-cobalt' : ''}`}>{n}</span>
          <span className="flex items-center gap-1 text-xs font-medium text-muted group-hover:text-ink">
            {label} <span aria-hidden="true">→</span>
          </span>
        </button>
      ))}
      </div>
    </Collapsible>
  );
}

function JobDetails({ matchId }) {
  const detail = useQuery({ queryKey: ['job', matchId], queryFn: () => api(`/jobs/${matchId}`) });
  if (detail.isPending) return <p className="px-5 pb-5 text-sm text-muted">Loading details…</p>;
  if (detail.isError) return <p className="px-5 pb-5 text-sm text-danger">{detail.error.message}</p>;
  const { job, fit, ai } = detail.data;
  return (
    <div className="grid gap-6 border-t border-line px-5 py-5 md:grid-cols-[1fr_280px]">
      <div className="min-w-0 space-y-6">
        <TailorCard jobId={job._id} />
        <FitExplained fit={fit} ai={ai} matchId={matchId} />
        <JobAtsCheck matchId={matchId} />
        <h3 className="text-sm font-semibold">About the role</h3>
        <div className="-mt-4 max-h-[28rem] overflow-y-auto pr-2 text-sm leading-relaxed whitespace-pre-wrap text-muted">
          {job.description || 'This source gave no description. Open the job page to read it.'}
        </div>
      </div>
      <aside className="space-y-5 md:border-l md:border-line md:pl-6">
        <a className="btn w-full" href={job.applyUrl || job.url} target="_blank" rel="noreferrer">
          Apply on the job page
          <Icon name="external" />
        </a>
        <p className="-mt-3 text-xs text-muted">
          {job.liveness?.status === 'active'
            ? `Still open: ${job.liveness.reason.toLowerCase()} (checked ${timeAgo(job.liveness.checkedAt)}).`
            : job.liveness?.status === 'unknown'
              ? `Couldn't confirm it's open: ${job.liveness.reason.toLowerCase()}.`
              : 'Not checked yet; the next search checks it.'}
        </p>
        <AppliedHere job={job} />
        <Contacts matchId={matchId} initial={job.contacts} />
      </aside>
    </div>
  );
}

const KIND_LABEL = { hiring: 'Hiring', general: 'General', personal: 'From the job post' };

function Contacts({ matchId, initial }) {
  const [website, setWebsite] = useState('');
  const find = useMutation({ meta: { inline: true },
    mutationFn: () => api(`/jobs/${matchId}/contacts`, { method: 'POST', body: website ? { website: website.trim() } : {} }),
  });
  const contacts = find.data ?? (initial?.checkedAt ? initial : null);
  return (
    <div>
      <h3 className="text-sm font-semibold">Contact emails</h3>
      <p className="mt-1 text-xs text-muted">From the job post and the company's own careers and contact pages. Websites only give role addresses like hr@.</p>

      {contacts && (
        <div className="mt-3 text-sm">
          {contacts.emails.length === 0 ? (
            <p className="text-muted">{contacts.note || 'No published contact email found.'}</p>
          ) : (
            <ul className="space-y-2">
              {contacts.emails.map((c) => (
                <li key={c.email}>
                  <a className="inline-flex items-center gap-1.5 font-medium break-all text-cobalt hover:underline" href={`mailto:${c.email}`}>
                    <Icon name="mail" className="size-3.5 shrink-0" />
                    {c.email}
                  </a>
                  <p className="text-xs text-faint">
                    {KIND_LABEL[c.kind]}, found on{' '}
                    {c.foundOn.startsWith('http') ? (
                      <a className="underline" href={c.foundOn} target="_blank" rel="noreferrer">
                        {new URL(c.foundOn).pathname}
                      </a>
                    ) : (
                      c.foundOn
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {contacts.website && <p className="mt-2 text-xs text-faint">Website checked: {contacts.website}</p>}
        </div>
      )}

      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          find.mutate();
        }}
      >
        <label className="block">
          <span className="sr-only">Company website</span>
          <input className="input" type="url" placeholder="Company website, if known" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
        <button className="btn-outline w-full" disabled={find.isPending}>
          {find.isPending ? 'Checking the website…' : contacts ? 'Search again' : 'Find contact emails'}
        </button>
      </form>
      {find.isError && <p className="mt-2 text-sm text-danger">{find.error.issues?.[0]?.message ?? find.error.message}</p>}
    </div>
  );
}

// The 0–100 rule score: bold when strong, quieter as it drops. Not a grade, an ordering.
function FitBadge({ score }) {
  if (score == null) return <span className="w-10 shrink-0" />;
  // pink = AI: strong fits filled, fair ones tinted, weak ones plain
  const tone =
    score >= 75 ? 'border-transparent bg-pink text-on-accent' : score >= 50 ? 'border-pink/30 bg-pink-soft text-pink' : 'border-line text-faint';
  return (
    <span className={`grid size-10 shrink-0 place-items-center rounded-lg border text-base font-semibold ${tone}`} title={`Fit score: ${score} out of 100`}>
      {score}
    </span>
  );
}

const VERDICT = { apply: ['Apply', 'bg-ok/10 text-ok'], maybe: ['Maybe', 'bg-marigold-soft text-ink'], skip: ['Skip', 'bg-danger/10 text-danger'] };
function VerdictChip({ ai }) {
  const [label, tone] = VERDICT[ai.verdict];
  return (
    <span className={`rounded-md px-1.5 py-0.5 font-medium ${tone}`} title="Gemini's review">
      {label} {ai.rating}/5
    </span>
  );
}

const PARTS = [
  ['skills', 'Skills', 40],
  ['role', 'Role', 15],
  ['experience', 'Experience', 15],
  ['location', 'Location', 15],
  ['freshness', 'Freshness', 10],
  ['pay', 'Pay', 5],
];

function FitExplained({ fit, ai, matchId }) {
  const queryClient = useQueryClient();
  const review = useMutation({ meta: { inline: true },
    mutationFn: () => api(`/jobs/${matchId}/review`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job', matchId] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
  return (
    <section className="grid gap-5 sm:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold">Why it scores {fit?.score ?? '–'}</h3>
        {fit ? (
          <dl className="mt-2 space-y-1.5 text-sm">
            {PARTS.map(([key, label, max]) => (
              <div key={key} className="grid grid-cols-[88px_1fr_44px] items-center gap-2">
                <dt className="text-muted">{label}</dt>
                <dd className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                  <div className="h-full rounded-full bg-ink" style={{ width: `${(fit.parts[key] / max) * 100}%` }} />
                </dd>
                <dd className="text-right text-xs text-muted">
                  {fit.parts[key]}/{max}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-sm text-muted">Scored after the next search.</p>
        )}
        {fit?.matchedSkills?.length > 0 && <p className="mt-2 text-xs text-muted">Your skills it mentions: {fit.matchedSkills.join(', ')}</p>}
      </div>

      <div>
        <h3 className="text-sm font-semibold">AI review</h3>
        {/* unreviewed jobs still have an empty ai object ({ reasons: [] }), so check the verdict itself */}
        {ai?.verdict ? (
          <div className="mt-2 space-y-2 text-sm">
            <p>
              <VerdictChip ai={ai} />
            </p>
            <ul className="list-disc space-y-1 pl-4 text-muted">
              {ai.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {ai.missingSkills.length > 0 && <p className="text-xs text-muted">Missing from your profile: {ai.missingSkills.join(', ')}</p>}
            {ai.redFlags.length > 0 && (
              <ul className="space-y-0.5 text-xs text-marigold">
                {ai.redFlags.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">Your top jobs get a review after each search. Ask for this one now if you like.</p>
        )}
        <button className="btn-outline mt-3" onClick={() => review.mutate()} disabled={review.isPending}>
          {review.isPending ? 'Reviewing…' : ai ? 'Review again' : 'Review with AI'}
        </button>
        {review.isError && <p className="mt-2 text-sm text-danger">{review.error.message}</p>}
      </div>
    </section>
  );
}
