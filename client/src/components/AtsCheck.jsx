import { useMutation } from '@tanstack/react-query';
import { api } from '../api.js';
import { Icon } from './ui.jsx';

// ATS check of the resume PDF on your Profile: on its own (ResumeCheck) and against one job (JobAtsCheck).
// A realistic simulation of how ATSs read and filter resumes; no company publishes its real scoring.

const MARK = { ok: ['✓', 'text-ok'], warn: ['!', 'text-marigold'], fail: ['✕', 'text-danger'] };

export function Findings({ items }) {
  return (
    <ul className="space-y-1 text-sm">
      {items.map((f) => (
        <li key={f.text} className="flex gap-2">
          <span className={`w-4 shrink-0 text-center font-bold ${MARK[f.level][1]}`} aria-label={f.level}>
            {MARK[f.level][0]}
          </span>
          <span className={f.level === 'ok' ? 'text-muted' : undefined}>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

const errorOf = (m) => m.isError && <p className="text-sm text-danger">{m.error.message}</p>;

export function ResumeCheck() {
  const check = useMutation({ meta: { inline: true }, mutationFn: () => api('/ats/resume', { method: 'POST' }) });
  const r = check.data;
  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">ATS check</h2>
          <p className="text-sm text-muted">Reads your resume PDF the way an applicant-tracking system does, and checks it for the skills recruiters search.</p>
        </div>
        <button className="btn-outline" onClick={() => check.mutate()} disabled={check.isPending}>
          <Icon name="check" />
          {check.isPending ? 'Checking…' : r ? 'Check again' : 'Check my resume'}
        </button>
      </div>
      {errorOf(check)}
      {r && (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Can an ATS read {r.file}?</h3>
            <Findings items={r.readability} />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Recruiter search test</h3>
            <p className="mb-2 text-xs text-muted">The skills your {r.jobsCompared} best-fit jobs ask for most, and whether your resume has them.</p>
            {r.searchTest.length ? (
              <ul className="space-y-1 text-sm">
                {r.searchTest.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`w-4 text-center font-bold ${s.found ? 'text-ok' : 'text-danger'}`}>{s.found ? '✓' : '✕'}</span>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-faint">in {s.jobs} jobs</span>
                    {s.tip && <span className="w-full pl-6 text-xs text-marigold">{s.tip}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No jobs in your feed yet to compare with.</p>
            )}
            <p className="mt-3 text-xs text-faint">Only add skills you really have. Then update your CV file and upload it again.</p>
          </div>
        </div>
      )}
    </section>
  );
}

export function Chips({ items, tone }) {
  return items.map((s) => (
    <span key={s} className={`rounded-md px-1.5 py-0.5 text-xs ${tone}`}>
      {s}
    </span>
  ));
}

export function JobAtsCheck({ matchId }) {
  const check = useMutation({ meta: { inline: true }, mutationFn: () => api(`/ats/job/${matchId}`, { method: 'POST' }) });
  const suggest = useMutation({ meta: { inline: true }, mutationFn: () => api(`/ats/job/${matchId}/suggest`, { method: 'POST' }) });
  const r = check.data;
  const tone = r && (r.score >= 75 ? 'text-ok' : r.score >= 50 ? 'text-marigold' : 'text-danger');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">ATS check for this job</h3>
        <button className="btn-ghost px-2 text-xs" onClick={() => check.mutate()} disabled={check.isPending}>
          <Icon name="check" />
          {check.isPending ? 'Checking…' : r ? 'Check again' : 'Check my resume for this job'}
        </button>
      </div>
      {!r && !check.isPending && !check.isError && <p className="mt-1 text-sm text-muted">Compares your resume PDF with what this job asks for, like an ATS would.</p>}
      {errorOf(check)}
      {r && (
        <div className="mt-2 space-y-3 text-sm">
          <p>
            <span className={`text-2xl font-semibold ${tone}`}>{r.score}%</span> <span className="text-muted">match</span>
            <span className="ml-2 text-xs text-faint">(required skills 70, preferred 20, job title 10)</span>
          </p>
          <div className="flex flex-wrap gap-1">
            <Chips items={r.required.found} tone="bg-ok/10 text-ok" />
            <Chips items={r.required.missing} tone="bg-danger/10 text-danger" />
          </div>
          {(r.preferred.found.length > 0 || r.preferred.missing.length > 0) && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted">Nice to have:</span>
              <Chips items={r.preferred.found} tone="bg-ok/10 text-ok" />
              <Chips items={r.preferred.missing} tone="bg-sunken text-muted" />
            </div>
          )}
          {r.risks.length > 0 && <Findings items={r.risks} />}
          {r.tips.map((t) => (
            <p key={t} className="text-xs text-marigold">
              {t}
            </p>
          ))}

          <button className="btn-outline" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
            <Icon name="sparkle" />
            {suggest.isPending ? 'Writing suggestions…' : 'Suggest edits for this job'}
          </button>
          {errorOf(suggest)}
          {suggest.data && (
            <ol className="space-y-3">
              {suggest.data.map((s, i) => (
                <li key={i} className="rounded-lg border border-line p-3">
                  <p className="text-xs font-medium text-muted">{s.section}</p>
                  {s.before && <p className="mt-1 text-faint line-through">{s.before}</p>}
                  <p className="mt-1">{s.after}</p>
                  <p className="mt-1 text-xs text-muted">{s.reason}</p>
                  {(s.needsConfirmation || s.warnings.length > 0) && (
                    <p className="mt-1 text-xs text-marigold">Check before using: {[...(s.needsConfirmation ? ['fill in or confirm it is true'] : []), ...s.warnings].join('; ')}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {suggest.data && <p className="text-xs text-faint">Copy the edits you agree with into your CV file, then upload it in Settings and check again.</p>}
        </div>
      )}
    </div>
  );
}
