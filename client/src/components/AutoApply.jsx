import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Icon } from './ui.jsx';

// Auto-apply, used on the Jobs page: the review queue (ApplyQueue) with each application's answers (Review),
// and on Preferences: your standard answers (ApplyAnswers).

export const APPLY_STATUS = {
  preparing: ['Filling the form…', 'text-cobalt'],
  prepared: ['Ready for review', 'text-ok'],
  submitting: ['Submitting…', 'text-cobalt'],
  opened: ['Window open: finish and submit', 'text-marigold'],
  applied: ['Applied', 'text-ok'],
  skipped: ['Skipped', 'text-faint'],
  failed: ['Failed', 'text-danger'],
};
const busyStatus = (s) => ['preparing', 'submitting', 'opened'].includes(s);

export function ApplyQueue({ onChange }) {
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ['applyQueue'], queryFn: () => api('/apply/queue'), refetchInterval: (q) => (q.state.data?.items.some((i) => busyStatus(i.status)) ? 4000 : false) });
  const [open, setOpen] = useState(null);
  const refresh = () => (queryClient.invalidateQueries({ queryKey: ['applyQueue'] }), onChange?.());
  const submit = useMutation({ mutationFn: (ids) => api('/apply/submit', { method: 'POST', body: { ids } }), onSuccess: refresh });

  // when something finishes in the background, the job list's badges change too
  const busy = queue.data?.items.filter((i) => busyStatus(i.status)).length ?? 0;
  useEffect(() => {
    onChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const items = queue.data?.items ?? [];
  if (!items.length) return null;
  const reviewed = items.filter((i) => i.status === 'prepared' && !i.needsYou);

  return (
    <section className="panel mb-5">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold tracking-tight">Auto-apply</h2>
          <p className="text-xs text-muted">
            Check each filled form, then Submit. {queue.data.today} of {queue.data.dailyLimit} applications in the last 24 hours.
          </p>
        </div>
        {reviewed.length > 0 && (
          <button className="btn" onClick={() => submit.mutate(reviewed.map((i) => i._id))} disabled={submit.isPending}>
            <Icon name="check" />
            Submit {reviewed.length} ready
          </button>
        )}
      </header>
      {submit.data?.overLimit > 0 && <p className="px-4 pt-2 text-xs text-marigold">{submit.data.overLimit} held back by the daily limit of {submit.data.dailyLimit}.</p>}
      {submit.isError && <p className="px-4 pt-2 text-sm text-danger">{submit.error.message}</p>}
      <ul className="divide-y divide-line">
        {items.map((i) => {
          const [label, tone] = APPLY_STATUS[i.status];
          return (
            <li key={i._id}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="font-medium">{i.company}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{i.title}</span>
                <span className={`text-xs font-medium ${tone}`}>{label}</span>
                {i.status === 'prepared' && i.needsYou > 0 && <span className="text-xs text-marigold">{i.needsYou} to answer</span>}
                {!busyStatus(i.status) || i.status === 'opened' ? (
                  <button className="btn-ghost px-2 text-xs" onClick={() => setOpen(open === i._id ? null : i._id)} aria-expanded={open === i._id}>
                    {open === i._id ? 'Close' : 'Review'}
                  </button>
                ) : null}
                {i.status === 'prepared' && (
                  <button className="btn-outline px-3 py-1 text-xs" onClick={() => submit.mutate([i._id])} disabled={submit.isPending}>
                    Submit
                  </button>
                )}
              </div>
              {i.error && <p className="px-4 pb-2 text-xs text-muted">{i.error}</p>}
              {open === i._id && <Review id={i._id} matchId={i.matchId} onChange={refresh} onSubmit={() => submit.mutate([i._id])} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const SOURCE = { profile: 'Profile', answers: 'Your answers', ai: 'AI', you: 'You', resume: 'Resume PDF', blank: 'Blank' };

function Review({ id, matchId, onChange, onSubmit }) {
  const queryClient = useQueryClient();
  const app = useQuery({ queryKey: ['apply', id], queryFn: () => api(`/apply/${id}`) });
  const [edits, setEdits] = useState({});
  const [shot, setShot] = useState(null);
  useEffect(() => {
    let url;
    api(`/apply/${id}/screenshot`, { blob: true })
      .then((b) => setShot((url = URL.createObjectURL(b))))
      .catch(() => setShot(null));
    return () => url && URL.revokeObjectURL(url);
  }, [id, app.data?.updatedAt]);
  const after = (d) => (d?._id && queryClient.setQueryData(['apply', id], d), setEdits({}), onChange());
  const save = useMutation({ mutationFn: () => api(`/apply/${id}`, { method: 'PUT', body: { fields: Object.entries(edits).map(([fid, value]) => ({ id: fid, value })) } }), onSuccess: after });
  const openMe = useMutation({ mutationFn: () => api(`/apply/${id}/open`, { method: 'POST' }), onSuccess: after });
  const applied = useMutation({ mutationFn: () => api(`/apply/${id}/applied`, { method: 'POST' }), onSuccess: after });
  const skip = useMutation({ mutationFn: () => api(`/apply/${id}/skip`, { method: 'POST' }), onSuccess: after });
  const redo = useMutation({ mutationFn: () => api('/apply/prepare', { method: 'POST', body: { matchIds: [matchId] } }), onSuccess: after });
  const error = save.error ?? openMe.error ?? applied.error ?? skip.error ?? redo.error;

  if (app.isPending) return <p className="border-t border-line px-4 py-3 text-sm text-muted">Loading…</p>;
  if (app.isError) return <p className="border-t border-line px-4 py-3 text-sm text-danger">{app.error.message}</p>;
  const fields = app.data.fields.filter((f) => f.kind !== 'file' || f.source === 'resume');
  const blank = (f) => (edits[f.id] ?? f.value) == null || (edits[f.id] ?? f.value) === '';
  const needs = fields.filter((f) => blank(f) && f.needsYou).length;
  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="grid gap-5 border-t border-line bg-paper px-4 py-4 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0">
        <p className="mb-2 text-sm">
          {needs > 0 ? <span className="text-marigold">{needs} required question(s) need your answer before it can be submitted for you.</span> : <span className="text-ok">Every required question has an answer.</span>}
        </p>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {fields.map((f) => {
            const value = edits[f.id] ?? f.value ?? '';
            const set = (v) => setEdits({ ...edits, [f.id]: v });
            return (
              <li key={f.id} className={`grid gap-1 px-3 py-2 sm:grid-cols-2 sm:gap-3 ${blank(f) && f.needsYou ? 'bg-marigold-soft/40' : ''}`}>
                <span className="text-muted">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                  <span className="ml-1 text-xs text-faint">({SOURCE[f.source]})</span>
                </span>
                {f.kind === 'file' ? (
                  <span className="text-ok">Your resume PDF</span>
                ) : f.options?.length && f.kind !== 'checkbox' ? (
                  <select className="input" value={value} onChange={(e) => set(e.target.value)} aria-label={f.label}>
                    <option value="">Leave blank</option>
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : f.kind === 'textarea' ? (
                  <textarea className="input" rows={3} value={Array.isArray(value) ? value.join(', ') : value} onChange={(e) => set(e.target.value)} aria-label={f.label} />
                ) : (
                  <input className="input" value={Array.isArray(value) ? value.join(', ') : value} onChange={(e) => set(e.target.value)} aria-label={f.label} />
                )}
              </li>
            );
          })}
        </ul>
        {error && <p className="mt-3 text-sm text-danger">{error.issues?.[0]?.message ?? error.message}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {dirty ? (
            <button className="btn" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save answers'}
            </button>
          ) : (
            ['prepared', 'failed', 'opened'].includes(app.data.status) && (
              <button className="btn" onClick={onSubmit}>
                <Icon name="check" />
                Submit
              </button>
            )
          )}
          <button className="btn-ghost" onClick={() => openMe.mutate()} disabled={openMe.isPending} title="Open the filled form in a window and finish it yourself">
            <Icon name="external" />
            Open myself
          </button>
          <button className="btn-ghost" onClick={() => applied.mutate()}>
            Mark as applied
          </button>
          <button className="btn-ghost" onClick={() => redo.mutate()} disabled={redo.isPending}>
            Fill again
          </button>
          <button className="btn-ghost hover:text-danger" onClick={() => skip.mutate()}>
            Skip
          </button>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs text-muted">The form as filled (before submitting)</p>
        {shot ? (
          <a href={shot} target="_blank" rel="noreferrer">
            <img src={shot} alt="Screenshot of the filled application form" className="max-h-[30rem] w-full rounded-lg border border-line object-cover object-top" />
          </a>
        ) : (
          <p className="text-sm text-faint">No screenshot.</p>
        )}
      </div>
    </div>
  );
}

const ANSWER_FIELDS = [
  ['noticePeriod', 'Notice period', '30 days'],
  ['currentCtc', 'Current pay', '12 LPA'],
  ['expectedCtc', 'Expected pay', '18 LPA'],
  ['workAuthorization', 'Work authorization', 'Indian citizen; authorized to work in India only'],
  ['needsSponsorship', 'Need visa sponsorship?', 'No for India; yes for other countries'],
  ['willingToRelocate', 'Willing to relocate?', 'Yes, within India'],
  ['earliestStart', 'Earliest start', 'Within 30 days'],
  ['howDidYouHear', 'How did you hear about us', 'Company careers page'],
];

// Answers every application form asks that a resume doesn't say. Filled once, on Preferences.
export function ApplyAnswers() {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ['applyAnswers'], queryFn: () => api('/apply/answers') });
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (saved.data && !draft) setDraft(saved.data);
  }, [saved.data, draft]);
  const save = useMutation({ mutationFn: () => api('/apply/answers', { method: 'PUT', body: draft }), onSuccess: (d) => queryClient.setQueryData(['applyAnswers'], d) });
  if (!draft) return null;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-muted">Auto-apply uses only these and your profile to fill application forms. Anything else is left for you to answer.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {ANSWER_FIELDS.map(([key, label, placeholder]) => (
          <label key={key} className="block">
            <span className="text-xs font-medium text-muted">{label}</span>
            <input className="input mt-1" placeholder={placeholder} value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="text-xs font-medium text-muted">Anything else forms often ask (languages, etc.)</span>
        <textarea className="input mt-1" rows={2} value={draft.extra ?? ''} onChange={(e) => setDraft({ ...draft, extra: e.target.value })} />
      </label>
      <div className="flex items-center gap-3">
        <button className="btn" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save answers'}
        </button>
        {save.isSuccess && <span className="text-sm text-ok">Saved</span>}
        {save.isError && <span className="text-sm text-danger">{save.error.issues?.[0]?.message ?? save.error.message}</span>}
      </div>
    </form>
  );
}
