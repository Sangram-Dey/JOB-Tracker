import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Icon, PageHeader, timeAgo } from '../components/ui.jsx';
import { JobAtsCheck } from '../components/AtsCheck.jsx';
import { ApplyQueue, APPLY_STATUS } from '../components/AutoApply.jsx';

const MODE_LABEL = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', unknown: 'Mode not given' };
const SOURCE_LABEL = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  freehire: 'freehire',
  jsearch: 'JSearch',
  remotive: 'Remotive',
  remoteok: 'Remote OK',
  himalayas: 'Himalayas',
  weworkremotely: 'We Work Remotely',
};
const TABS = [
  ['new', 'New'],
  ['saved', 'Saved'],
  ['hidden', 'Hidden'],
];
const FRESH_MS = 86_400_000;

export default function JobsPage({ onNavigate }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('new');
  const [workMode, setWorkMode] = useState('');
  const [q, setQ] = useState(''); // applied search text
  const [draftQ, setDraftQ] = useState(''); // what's typed in the box
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('fit');
  const [autoOnly, setAutoOnly] = useState(false); // only jobs auto-apply can fill
  const [all, setAll] = useState(false); // "Show all jobs found": ignore pay, age, experience and platform settings

  const params = new URLSearchParams({ status, page, sort, ...(q && { q }), ...(workMode && { workMode }), ...(all && { all: '1' }), ...(autoOnly && { autoApply: '1' }) });
  const jobs = useQuery({ queryKey: ['jobs', status, q, workMode, sort, page, all, autoOnly], queryFn: () => api(`/jobs?${params}`) });
  // { run, running, error }: checked every few seconds while a background search runs
  const lastRun = useQuery({ queryKey: ['lastRun'], queryFn: () => api('/jobs/runs/latest'), refetchInterval: (q) => (q.state.data?.running ? 4000 : false) });

  // Saved jobs show at once; opening the page also starts a background search if the last one is over an hour old.
  useEffect(() => {
    api('/jobs/refresh', { method: 'POST' })
      .then((r) => r.started && queryClient.invalidateQueries({ queryKey: ['lastRun'] }))
      .catch(() => {}); // the Search now button still works and shows its own errors
  }, [queryClient]);
  // A finished search (new run id) brings new jobs: reload the list.
  const runId = lastRun.data?.run?._id;
  const seenRun = useRef(runId);
  useEffect(() => {
    if (seenRun.current && runId !== seenRun.current) queryClient.invalidateQueries({ queryKey: ['jobs'] });
    seenRun.current = runId;
  }, [runId, queryClient]);

  const search = useMutation({
    mutationFn: () => api('/jobs/search', { method: 'POST' }),
    onSuccess: (run) => queryClient.setQueryData(['lastRun'], { run, running: false, error: null }),
  });
  const searching = search.isPending || lastRun.data?.running;
  // Auto-apply: tick jobs on Greenhouse/Lever/Ashby forms, then Prepare; they appear in the review queue above.
  const [picked, setPicked] = useState([]);
  const pick = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < 20 ? [...picked, id] : picked);
  const prepare = useMutation({
    mutationFn: () => api('/apply/prepare', { method: 'POST', body: { matchIds: picked } }),
    onSuccess: () => {
      setPicked([]);
      queryClient.invalidateQueries({ queryKey: ['applyQueue'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
  const move = useMutation({
    mutationFn: ({ id, status }) => api(`/jobs/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const filter = (fn) => (...args) => {
    fn(...args);
    setPage(1);
  };
  const filtered = q || workMode || autoOnly;

  return (
    <div className={picked.length ? "pb-24" : undefined}>
      <PageHeader
        title="Jobs"
        actions={
          <button className="btn" onClick={() => search.mutate()} disabled={searching}>
            <Icon name="search" />
            {searching ? 'Searching…' : 'Search now'}
          </button>
        }
      >
        {lastRun.data?.run ? (
          <RunSummary run={lastRun.data.run} onNavigate={onNavigate} />
        ) : (
          'New matches arrive every six hours. Search now to get the first ones.'
        )}
      </PageHeader>
      {lastRun.data?.running && !search.isPending && (
        <p className="mb-4 rounded-lg bg-sunken px-3 py-2 text-sm text-muted" role="status">
          Fetching new jobs in the background. Your saved jobs are below; new ones appear when it finishes.
        </p>
      )}
      {(search.error?.message ?? lastRun.data?.error) && (
        <p className="mb-4 rounded-lg bg-marigold-soft px-3 py-2 text-sm text-ink">{search.error?.message ?? lastRun.data.error}</p>
      )}

      <ApplyQueue onChange={() => queryClient.invalidateQueries({ queryKey: ['jobs'] })} />
      {prepare.isError && <p className="mb-4 rounded-lg bg-marigold-soft px-3 py-2 text-sm text-ink">{prepare.error.message}</p>}

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label="Show">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={status === value}
              onClick={() => filter(setStatus)(value)}
              className={`rounded-md px-3 py-1 text-sm ${status === value ? 'bg-ink font-medium text-surface' : 'text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="flex flex-1 flex-wrap justify-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            filter(setQ)(draftQ.trim());
          }}
        >
          <label className="relative min-w-48 flex-1 sm:max-w-72">
            <span className="sr-only">Search title, company or place</span>
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input className="input pl-9" placeholder="Title, company or place" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} />
          </label>
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
              <option value="fit">Best fit</option>
              <option value="posted">Newest posted</option>
              <option value="pay">Highest pay</option>
              <option value="found">Recently found</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted" title="Only Greenhouse, Lever and Ashby jobs: tick them, then Prepare">
            <input type="checkbox" checked={autoOnly} onChange={(e) => filter(setAutoOnly)(e.target.checked)} />
            Auto-apply only
          </label>
          <label className="flex items-center gap-2 text-sm text-muted" title="Includes jobs your pay, experience, date or platform settings would hide">
            <input type="checkbox" checked={all} onChange={(e) => filter(setAll)(e.target.checked)} />
            Show all jobs found
          </label>
        </form>
      </div>

      {(jobs.data?.hiddenByPreferences > 0 || jobs.data?.closedOrJunk > 0) && (
        <p className="mb-3 text-sm text-muted">
          {jobs.data.total} shown.
          {jobs.data.closedOrJunk > 0 && ` ${jobs.data.closedOrJunk} hidden because they're closed or look like junk.`}
          {jobs.data.hiddenByPreferences > 0 && (
            <>
              {' '}
              {jobs.data.hiddenByPreferences} hidden by your pay, experience, date or platform settings.{' '}
              <button className="text-cobalt hover:underline" onClick={() => filter(setAll)(true)}>
                Show them
              </button>
              {' · '}
              <button className="text-cobalt hover:underline" onClick={() => onNavigate('preferences')}>
                Change preferences
              </button>
            </>
          )}
        </p>
      )}
      {jobs.isPending && <ListSkeleton />}
      {jobs.isError && <p className="text-sm text-danger">{jobs.error.message}</p>}
      {jobs.data?.items.length === 0 && (
        <EmptyState status={status} filtered={filtered} onNavigate={onNavigate} onSearch={() => search.mutate()} searching={searching} />
      )}
      {jobs.data?.items.length > 0 && (
        <ul className="panel divide-y divide-line overflow-hidden">
          {jobs.data.items.map((m) => (
            <JobRow key={m._id} match={m} onMove={(to) => move.mutate({ id: m._id, status: to })} busy={move.isPending} picked={picked.includes(m._id)} onPick={() => pick(m._id)} />
          ))}
        </ul>
      )}

      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{picked.length} selected for auto-apply</span>
            <span className="text-xs text-muted">AI fills each form with your profile and standard answers; you review before anything is submitted.</span>
            <span className="ml-auto flex gap-2">
              <button className="btn-ghost" onClick={() => setPicked([])}>
                Clear
              </button>
              <button className="btn" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
                <Icon name="sparkle" />
                {prepare.isPending ? 'Starting…' : `Prepare ${picked.length} ${picked.length === 1 ? 'application' : 'applications'}`}
              </button>
            </span>
          </div>
        </div>
      )}

      {jobs.data && (page > 1 || jobs.data.hasMore) && (
        <nav className="mt-4 flex items-center justify-between text-sm text-muted" aria-label="Pages">
          <button className="btn-outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button className="btn-outline" disabled={!jobs.data.hasMore} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

function RunSummary({ run, onNavigate }) {
  const failed = run.boards.filter((b) => b.error);
  const found = run.boards.reduce((n, b) => n + b.fetched, 0);
  return (
    <>
      <p>
        Last searched {timeAgo(run.createdAt)}: {found} jobs looked at across {run.boards.length} searches,{' '}
        <strong className="font-medium text-ink">{run.newMatches} new for you</strong>.
        {run.liveness?.checked > 0 && ` ${run.liveness.checked} postings checked, ${run.liveness.closed} found closed.`}
      </p>
      {run.terms?.length > 0 && (
        <p className="mt-0.5 text-xs">
          Searched for {run.terms.join(', ')}
          {run.termsFrom === 'profile' && (
            <>
              {' '}
              (from your resume;{' '}
              <button className="text-cobalt hover:underline" onClick={() => onNavigate('preferences')}>
                set your own role keywords
              </button>
              )
            </>
          )}
        </p>
      )}
      {failed.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-marigold">
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
    </>
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
      <p className="font-display text-xl font-semibold">{text[0]}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{text[1]}</p>
      {status === 'new' && !filtered && (
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-outline" onClick={() => onNavigate('preferences')}>
            Open preferences
          </button>
          <button className="btn" onClick={onSearch} disabled={searching}>
            {searching ? 'Searching…' : 'Search now'}
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
  const canAutoApply = match.ats && !['applied', 'preparing', 'submitting'].includes(appStatus);
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
    <li className={open ? 'bg-sunken/40' : undefined}>
      <div className="flex gap-4 px-5 py-4">
        {/* a checkbox only where the app can fill the form; keeps the column aligned otherwise */}
        <span className="w-4 shrink-0 pt-3">
          {canAutoApply && <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Select ${match.job.title} for auto-apply`} />}
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
            {match.ats &&
              (appStatus ? (
                <span className={`font-medium ${APPLY_STATUS[appStatus][1]}`}>{APPLY_STATUS[appStatus][0]}</span>
              ) : (
                <span className="rounded-md bg-cobalt/10 px-1.5 py-0.5 font-medium text-cobalt" title="The app can fill this job's application form for you">
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
function JobDetails({ matchId }) {
  const detail = useQuery({ queryKey: ['job', matchId], queryFn: () => api(`/jobs/${matchId}`) });
  if (detail.isPending) return <p className="px-5 pb-5 text-sm text-muted">Loading details…</p>;
  if (detail.isError) return <p className="px-5 pb-5 text-sm text-danger">{detail.error.message}</p>;
  const { job, fit, ai } = detail.data;
  return (
    <div className="grid gap-6 border-t border-line px-5 py-5 md:grid-cols-[1fr_280px]">
      <div className="min-w-0 space-y-6">
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
        <Contacts matchId={matchId} initial={job.contacts} />
      </aside>
    </div>
  );
}

const KIND_LABEL = { hiring: 'Hiring', general: 'General', personal: 'From the job post' };

function Contacts({ matchId, initial }) {
  const [website, setWebsite] = useState('');
  const find = useMutation({
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
  const tone = score >= 75 ? 'border-ink text-ink' : score >= 50 ? 'border-line text-muted' : 'border-line text-faint';
  return (
    <span className={`grid size-10 shrink-0 place-items-center rounded-lg border font-display text-base font-semibold ${tone}`} title="Fit score out of 100">
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
  const review = useMutation({
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
