import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Icon } from './ui.jsx';

// Your resume tailored to one job, the same card on the Jobs tab, in HR emails and in auto-apply review.
// The server does the work in steps (resume/tailorJob.js); this card follows them live, then shows what changed.

const STEPS = [
  ['reading', 'Reading the job description'],
  ['keywords', 'Extracting keywords and matching your experience'],
  ['writing', 'Rewriting summary, bullets and skills'],
  ['checking', 'Fact-checking every change against your history'],
  ['pdf', 'Building the ATS-friendly PDF'],
];
const BUSY = ['queued', ...STEPS.map(([k]) => k)];
// Remodify can be limited to these (same ids as SECTIONS in server/src/resume/tailorJob.js)
const PARTS = [
  ['summary', 'Summary'],
  ['skills', 'Skills'],
  ['experience', 'Experience'],
  ['projects', 'Projects'],
];
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function openPdf(blob) {
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

// useOriginal / onUseOriginal: where the choice is per application (email, auto-apply). sendLabel: "attached", "uploaded"…
export function TailorCard({ jobId, useOriginal, onUseOriginal, sendLabel = 'sent' }) {
  const queryClient = useQueryClient();
  const key = ['tailor', jobId];
  const t = useQuery({ queryKey: key, queryFn: () => api(`/tailor/${jobId}`), refetchInterval: (q) => (BUSY.includes(q.state.data?.stage) ? 1200 : false) });
  const set = (d) => queryClient.setQueryData(key, d);
  const start = useMutation({ meta: { inline: true }, mutationFn: (body) => api(`/tailor/${jobId}`, { method: 'POST', body }), onSuccess: set });
  const undo = useMutation({ meta: { inline: true, success: 'Change undone and the PDF rebuilt' }, mutationFn: (index) => api(`/tailor/${jobId}/undo`, { method: 'POST', body: { index } }), onSuccess: set });
  const pick = useMutation({ meta: { inline: true }, mutationFn: (index) => api(`/tailor/${jobId}/version`, { method: 'POST', body: { index } }), onSuccess: set });
  const preview = useMutation({ meta: { inline: true }, mutationFn: (v) => api(`/tailor/${jobId}/pdf${v != null ? `?v=${v}` : ''}`, { blob: true }), onSuccess: openPdf });
  const [asking, setAsking] = useState(false);
  const [wish, setWish] = useState('');
  const [sections, setSections] = useState([]); // Remodify only these parts; none = all

  const d = t.data;
  const error = (start.error ?? undo.error ?? pick.error ?? preview.error)?.message;
  if (t.isPending) return <div className="skeleton h-28 rounded-xl" />;
  if (t.isError) return <p className="text-sm text-danger">{t.error.message}</p>;

  if (d.stage === 'none') {
    return (
      <section className="rounded-xl border border-dashed border-cobalt/40 bg-cobalt-soft/30 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <Icon name="sparkle" className="size-4 text-pink" /> Tailor your resume to this job
        </p>
        <p className="mt-1 text-muted">AI reads the job description, works its keywords into your real experience, fact-checks every change and builds a clean PDF.</p>
        <button className="btn mt-3" onClick={() => start.mutate({})} disabled={start.isPending}>
          <Icon name="sparkle" /> Tailor resume
        </button>
        {error && <p className="mt-2 text-danger">{error}</p>}
      </section>
    );
  }
  if (BUSY.includes(d.stage)) return <Analysing stage={d.stage} again={d.versions.length > 0} note={d.note} />;

  const v = d.versions[d.current];
  const using = v && !useOriginal;
  const remodify = () => {
    start.mutate({ again: true, instruction: wish, sections });
    setAsking(false);
    setWish('');
    setSections([]);
  };
  // Retry / Regenerate: run again from your own resume, nothing to type
  const regenerate = () => start.mutate(v || d.versions.length ? { again: true, fresh: true } : {});
  const toggle = (id) => setSections(sections.includes(id) ? sections.filter((x) => x !== id) : [...sections, id]);
  return (
    <section className="fade-in space-y-3 rounded-xl border border-pink/30 bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="sparkle" className="size-4 text-pink" />
        <h3 className="font-semibold">
          {!onUseOriginal ? (v ? 'Resume tailored to this job' : 'Your original resume') : using ? `Tailored resume will be ${sendLabel}` : `Your own resume PDF will be ${sendLabel}`}
        </h3>
        {d.versions.length > 0 && (
          <select className="input ml-auto w-auto py-1 text-xs" value={d.current} onChange={(e) => pick.mutate(Number(e.target.value))} aria-label="Resume version" disabled={pick.isPending}>
            <option value={-1}>My original</option>
            {d.versions.map((x, i) => (
              <option key={x._id ?? i} value={i}>
                Version {i + 1} · {x.after}%{x.instruction ? ` · ${x.instruction.slice(0, 24)}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {d.stage === 'failed' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft px-3 py-2 text-danger">
          <span className="min-w-0 flex-1">
            {d.error}
            {v ? ' The version below is still used.' : ''}
          </span>
          <button className="btn-outline px-3 py-1" onClick={regenerate} disabled={start.isPending}>
            <Icon name="undo" className="size-4 -scale-x-100" /> Retry
          </button>
        </div>
      )}
      {d.note && <p className="rounded-lg bg-sunken px-3 py-2 text-muted">{d.note}</p>}

      {v && (
        <>
          <Score before={v.before} after={v.after} key={v._id} />
          <Keywords k={v.keywords} />
          <Changes changes={v.changes} onUndo={(i) => undo.mutate(i)} undoing={undo.isPending ? undo.variables : null} />
        </>
      )}

      {asking && (
        <div className="pop-in space-y-3 rounded-lg border border-line bg-paper p-3">
          <div>
            <p className="text-xs font-semibold tracking-wider text-muted uppercase">Change only</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {PARTS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={sections.includes(id)}
                  onClick={() => toggle(id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${sections.includes(id) ? 'border-cobalt bg-cobalt text-on-accent' : 'border-line bg-surface text-muted hover:border-cobalt hover:text-cobalt'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-faint">{sections.length ? 'Other parts stay as they are.' : 'None picked: any part can change.'}</p>
          </div>
          <input
            className="input"
            value={wish}
            maxLength={200}
            autoFocus
            onChange={(e) => setWish(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && remodify()}
            placeholder="Optional: what to change, e.g. “focus on backend and APIs”"
          />
          <div className="flex gap-2">
            <button className="btn" onClick={remodify}>
              <Icon name="sparkle" /> Remodify
            </button>
            <button className="btn-ghost" onClick={() => (setAsking(false), setSections([]))}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {!asking && d.stage !== 'failed' && (
          <button className="btn-outline" onClick={regenerate} disabled={start.isPending} title="A new version from your own resume, nothing to type">
            <Icon name="undo" className="size-4 -scale-x-100" /> Regenerate
          </button>
        )}
        {!asking && v && (
          <button className="btn-outline" onClick={() => setAsking(true)} disabled={start.isPending} title="Change chosen parts of this version, with your instructions">
            <Icon name="sparkle" /> Remodify
          </button>
        )}
        {v && (
          <button className="btn-ghost" onClick={() => preview.mutate(d.current)} disabled={preview.isPending}>
            <Icon name="external" /> {preview.isPending ? 'Opening…' : onUseOriginal ? 'Preview PDF' : 'Open / download PDF'}
          </button>
        )}
        {v && onUseOriginal && (
          <button className="btn-ghost ml-auto" onClick={() => onUseOriginal(!useOriginal)}>
            {useOriginal ? 'Send the tailored one' : 'Send my own PDF instead'}
          </button>
        )}
      </div>
    </section>
  );
}

// The live analysis: real steps from the server, the current one pulsing, the rest waiting.
function Analysing({ stage, again, note }) {
  const at = STEPS.findIndex(([k]) => k === stage);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <section className="ai-working fade-in space-y-3 rounded-xl p-4 text-sm" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <Icon name="sparkle" className="size-4 animate-pulse text-pink" />
        <h3 className="font-semibold text-cobalt">{again ? 'AI is remodifying your resume' : 'AI is tailoring your resume to this job'}</h3>
        <span className="ml-auto text-xs text-faint tabular-nums">{stage === 'queued' ? 'waiting its turn' : `${seconds}s`}</span>
      </div>
      {note && <p className="rounded-lg bg-marigold-soft px-3 py-2 text-ink">{note}</p>}
      <ol className="space-y-1.5">
        {STEPS.map(([k, label], i) => {
          const done = at > i;
          const now = at === i;
          return (
            <li key={k} className={`flex items-center gap-2 transition-colors ${done ? 'text-ok' : now ? 'font-medium text-ink' : 'text-faint'}`}>
              <span className="grid size-5 place-items-center">
                {done ? (
                  <Icon name="check" className="pop-in size-4" />
                ) : now ? (
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-pink opacity-60" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-pink" />
                  </span>
                ) : (
                  <span className="size-1.5 rounded-full bg-line" />
                )}
              </span>
              {label}
              {now && '…'}
            </li>
          );
        })}
      </ol>
      <div className="space-y-1.5" aria-hidden="true">
        <div className="skeleton h-2.5 w-11/12" />
        <div className="skeleton h-2.5 w-9/12" />
        <div className="skeleton h-2.5 w-10/12" />
      </div>
    </section>
  );
}

// Keyword match, counting up from your original to the tailored version.
function Score({ before, after }) {
  const [shown, setShown] = useState(reduceMotion() ? after : before);
  useEffect(() => {
    if (reduceMotion()) return;
    const t0 = performance.now();
    let frame;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 900);
      setShown(Math.round(before + (after - before) * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [before, after]);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-muted">Keyword match</span>
        <span className="text-faint line-through">{before}%</span>
        <span className="text-2xl font-semibold text-ok tabular-nums">{shown}%</span>
        {after > before && <span className="rounded-md bg-ok-soft px-1.5 text-xs font-semibold text-ok">+{after - before}</span>}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full bg-cobalt transition-[width] duration-300" style={{ width: `${shown}%` }} />
      </div>
    </div>
  );
}

const GROUPS = [
  ['added', 'Added', 'bg-ok-soft text-ok', '+'],
  ['strengthened', 'Worked into more lines', 'bg-cobalt-soft text-cobalt', '↑'],
  ['missing', 'Not added: not in your history', 'bg-sunken text-faint', ''],
];
function Keywords({ k }) {
  let i = 0;
  return (
    <div className="space-y-2">
      {GROUPS.map(([key, label, tone, mark]) =>
        k?.[key]?.length ? (
          <div key={key}>
            <p className="mb-1 text-xs font-medium text-muted">{label}</p>
            <div className="flex flex-wrap gap-1">
              {k[key].map((w) => (
                <span key={w} className={`pop-in rounded-md px-1.5 py-0.5 text-xs font-medium ${tone}`} style={{ '--i': i++ }}>
                  {mark && `${mark} `}
                  {w}
                </span>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

const pathLabel = (p) => p.replace(/\.(\d+)/g, (_, n) => ` ${Number(n) + 1}`).replaceAll('.', ' › ');
function Changes({ changes, onUndo, undoing }) {
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, 3);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">
        {changes.length} change{changes.length > 1 ? 's' : ''} made by AI
      </p>
      <ul className="space-y-1.5">
        {shown.map((c, i) => (
          <li key={c.path + c.after} className="pop-in rounded-lg border border-line bg-paper px-3 py-2" style={{ '--i': i }}>
            <div className="flex items-start gap-2">
              <span className="text-xs text-faint">
                {c.kind === 'add' ? 'Added to' : 'Rewrote'} {pathLabel(c.path)}
                {c.keyword && <span className="ml-1 rounded bg-pink-soft px-1 text-pink">{c.keyword}</span>}
              </span>
              <button className="btn-ghost ml-auto px-2 py-0.5 text-xs" onClick={() => onUndo(i)} disabled={undoing != null}>
                {undoing === i ? 'Rebuilding…' : 'Undo'}
              </button>
            </div>
            {c.before && <p className="text-faint line-through">{c.before}</p>}
            <p className="text-ink">{c.after}</p>
          </li>
        ))}
      </ul>
      {changes.length > 3 && (
        <button className="btn-ghost mt-1 px-2 text-xs" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${changes.length}`}
        </button>
      )}
    </div>
  );
}
