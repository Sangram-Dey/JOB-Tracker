import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import FieldEditor from '../components/FieldEditor.jsx';
import { Findings, Chips } from '../components/AtsCheck.jsx';
import { Guide, Icon, Notice, PageHeader, toast } from '../components/ui.jsx';

// Resume page: edit your resume with a live ATS score, accept or edit AI suggestions, and export an ATS-friendly PDF.

const STEPS = [
  ['Pick a target', 'Your best-fit jobs in general, or one job from your feed to tailor for.'],
  ['Read the score', 'Keywords found and missing, and format checks. It updates as you type, with no AI.'],
  ['Get AI suggestions', 'Gemini suggests rewrites and missing keywords. Accept, edit or dismiss each one.'],
  ['Fill in [X]', 'A number the AI can’t know becomes [X]. Put in the real number or remove it: the PDF won’t export with one left.'],
  ['Save and export', 'Save to your profile, download the PDF, or make it the PDF your emails and applications attach.'],
];

const PLACEHOLDER = /\[(?:X|N|\d*\s*X)[^\]]{0,12}\]/i; // same as server/src/resume/draft.js
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const getAt = (obj, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), obj);
function setAt(obj, [k, ...rest], value) {
  const copy = Array.isArray(obj) ? [...obj] : { ...obj };
  copy[k] = rest.length ? setAt(obj[k], rest, value) : value;
  return copy;
}
const hasPlaceholder = (v) => (typeof v === 'string' ? PLACEHOLDER.test(v) : v && typeof v === 'object' && Object.values(v).some(hasPlaceholder));

// "experience.0.bullets.2" -> "Experience · CartNest · bullet 3"
function where(path, data) {
  const [section, i, field, j] = path.split('.');
  const name = { experience: 'company', projects: 'name', education: 'institution' }[section];
  const parts = [section[0].toUpperCase() + section.slice(1)];
  if (i != null && name) parts.push(data[section]?.[i]?.[name] || `#${Number(i) + 1}`);
  if (field) parts.push(j != null ? `${field.replace(/s$/, '')} ${Number(j) + 1}` : field);
  return parts.join(' · ');
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ResumePage({ onNavigate }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api('/profile') });
  return (
    <div>
      <PageHeader title="Resume">Improve your resume for ATS filters and recruiters, then export a clean one-column PDF.</PageHeader>
      <Guide id="resume" steps={STEPS} />
      {profile.isPending ? (
        <div className="panel h-64 animate-pulse" />
      ) : profile.isError ? (
        <Notice tone="error">{profile.error.message}</Notice>
      ) : !profile.data?.data ? (
        <Notice tone="warning" action={<button className="btn-outline" onClick={() => onNavigate('profile')}>Go to Settings</button>}>
          Upload your resume in Settings first. Its content is what you edit here.
        </Notice>
      ) : (
        <Editor key={profile.data._id} saved={profile.data} />
      )}
    </div>
  );
}

function Editor({ saved }) {
  const queryClient = useQueryClient();
  const [base, setBase] = useState(saved.data); // last saved version
  const [draft, setDraft] = useState(saved.data);
  const [undo, setUndo] = useState([]); // versions before each accepted suggestion
  const [matchId, setMatchId] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [usePdfResult, setUsePdfResult] = useState(null);
  const confirmDialog = useRef(null);
  const dirty = draft !== base;
  const placeholders = hasPlaceholder(draft);

  // score the draft a moment after typing stops
  const [scored, setScored] = useState(draft);
  useEffect(() => {
    const t = setTimeout(() => setScored(draft), 700);
    return () => clearTimeout(t);
  }, [draft]);
  const targets = useQuery({ queryKey: ['resumeTargets'], queryFn: () => api('/resume/targets') });
  const score = useQuery({
    queryKey: ['resumeScore', matchId, scored],
    queryFn: () => api('/resume/score', { method: 'POST', body: { data: scored, matchId: matchId || undefined } }),
    placeholderData: (prev) => prev,
    retry: false,
  });

  const afterSave = (profile) => {
    queryClient.setQueryData(['profile'], profile);
    setBase(profile.data);
    setDraft(profile.data);
    setUndo([]);
  };
  const save = useMutation({ meta: { inline: true, success: 'Resume saved to your profile' }, mutationFn: () => api('/profile', { method: 'PUT', body: { data: draft } }), onSuccess: afterSave });
  const reset = useMutation({ meta: { inline: true, success: 'Back to your uploaded resume' }, mutationFn: () => api('/resume/reset', { method: 'POST' }), onSuccess: afterSave });
  const suggest = useMutation({
    meta: { inline: true, success: (list) => (list.length ? `${list.length} suggestions ready` : 'No changes suggested: it already reads well for this target') },
    mutationFn: () => api('/resume/suggest', { method: 'POST', body: { data: draft, matchId: matchId || undefined } }),
    onSuccess: (list) => setSuggestions(list.map((s, i) => ({ ...s, id: `${Date.now()}-${i}` }))),
  });
  const pdf = useMutation({
    meta: { inline: true, success: 'PDF downloaded' },
    mutationFn: () => api('/resume/pdf', { method: 'POST', body: { data: draft }, blob: true }),
    onSuccess: (blob) => download(blob, `${draft.contact?.name || 'My'} Resume.pdf`),
  });
  const usePdf = useMutation({
    meta: { inline: true, success: 'This PDF is now attached to your emails and applications' },
    mutationFn: () => api('/resume/pdf/use', { method: 'POST', body: { data: draft } }),
    onSuccess: (r) => {
      confirmDialog.current?.close();
      setUsePdfResult(r);
      setBase(draft);
      setUndo([]);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  const edit = (next) => setDraft(next);
  const accept = (s, text) => {
    const keys = s.path.split('.');
    setUndo((u) => [...u.slice(-19), draft]);
    setDraft(s.kind === 'add' ? setAt(draft, keys, [...getAt(draft, s.path), text]) : setAt(draft, keys, text));
    setSuggestions((list) => list.filter((x) => x.id !== s.id));
    toast(PLACEHOLDER.test(text) ? 'Added: now replace [X] with the real number' : 'Suggestion applied', PLACEHOLDER.test(text) ? 'warning' : 'success');
  };
  // a rewrite whose field has changed since (you edited it, or accepted another) no longer applies
  const open = suggestions.filter((s) => s.kind === 'add' || norm(getAt(draft, s.path)) === norm(s.before));
  const busy = save.isPending || reset.isPending || usePdf.isPending;
  const error = [save, reset, pdf, usePdf].find((m) => m.isError)?.error;

  return (
    <div className="space-y-4">
      <section className="panel-controls flex flex-wrap items-end gap-3 p-4">
        <label className="min-w-64 flex-1">
          <span className="label">Improve for</span>
          <select className="input mt-1" value={matchId} onChange={(e) => setMatchId(e.target.value)}>
            <option value="">Your best-fit jobs in general</option>
            {targets.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} at {t.company}
                {t.fit != null ? ` (${t.fit}% fit)` : ''}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-outline" onClick={() => pdf.mutate()} disabled={pdf.isPending || placeholders} title={placeholders ? 'Fill in the [X] placeholders first' : undefined}>
          <Icon name="upload" className="size-4 rotate-180" />
          {pdf.isPending ? 'Making PDF…' : 'Download PDF'}
        </button>
        <button className="btn" onClick={() => confirmDialog.current?.showModal()} disabled={busy || placeholders} title={placeholders ? 'Fill in the [X] placeholders first' : undefined}>
          <Icon name="check" />
          Use as my resume PDF
        </button>
      </section>

      {placeholders && (
        <Notice tone="warning">
          <strong className="font-semibold">Some lines still have [X].</strong> Replace each with the real number, or reword the line without it. Saving and
          exporting are off until then, so a made-up number never reaches a recruiter.
        </Notice>
      )}
      {usePdfResult && (
        <Notice tone="success" action={<button className="btn-ghost" onClick={() => setUsePdfResult(null)}>Close</button>}>
          <p className="mb-2 font-semibold">{usePdfResult.file} is now your resume PDF. How an ATS reads it:</p>
          <Findings items={usePdfResult.readability} />
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="panel px-6 sm:px-8">
            <FieldEditor value={draft} onChange={edit} />
          </div>
          <div className="sticky bottom-0 z-10 mt-4 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-surface/95 sm:px-5">
            <span className="mr-auto text-sm" role="status">
              {error ? <span className="text-danger">{error.message}</span> : dirty ? <span className="text-marigold">Unsaved changes</span> : <span className="text-muted">All changes saved</span>}
            </span>
            {score.data?.hasOriginal && (
              <button className="btn-ghost" onClick={() => reset.mutate()} disabled={busy} title="Go back to what your last upload said">
                Reset to upload
              </button>
            )}
            {undo.length > 0 && (
              <button className="btn-ghost" onClick={() => (setDraft(undo.at(-1)), setUndo(undo.slice(0, -1)))}>
                <Icon name="undo" />
                Undo
              </button>
            )}
            {dirty && (
              <button className="btn-ghost" onClick={() => (setDraft(base), setUndo([]))}>
                Discard
              </button>
            )}
            <button className="btn" onClick={() => save.mutate()} disabled={!dirty || busy || placeholders}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <ScorePanel score={score} />
          <section className="panel space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">AI suggestions</h2>
                <p className="text-sm text-muted">Gemini, using only facts from your own history.</p>
              </div>
              <button className="btn-outline shrink-0" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
                <Icon name="sparkle" />
                {suggest.isPending ? 'Thinking…' : open.length ? 'Again' : 'Suggest'}
              </button>
            </div>
            {suggest.isError && <Notice tone="error" className="">{suggest.error.message}</Notice>}
            {suggest.isPending && <div className="h-24 animate-pulse rounded-xl bg-sunken" />}
            {!suggest.isPending && !open.length && !suggest.isError && (
              <p className="text-sm text-muted">{suggest.isSuccess ? 'All done. Ask again after more edits.' : 'Click Suggest for rewrites and missing keywords. Each one shows what changes, and why.'}</p>
            )}
            {open.map((s) => (
              <SuggestionCard key={s.id} s={s} label={where(s.path, draft)} onAccept={(text) => accept(s, text)} onDismiss={() => setSuggestions((l) => l.filter((x) => x.id !== s.id))} />
            ))}
          </section>
        </aside>
      </div>

      <dialog ref={confirmDialog} className="dialog">
        <h2 className="mb-1 text-lg font-semibold tracking-tight">Use this as your resume PDF?</h2>
        <p className="text-sm text-muted">
          This saves your edits and replaces <strong className="text-ink">{saved.resumePdf?.name ?? 'your current PDF'}</strong> with a clean one-column PDF made from them.
          HR emails and auto-apply will attach the new file. Keep a copy of your original if you want it back.
        </p>
        {usePdf.isError && <p className="mt-2 text-sm text-danger">{usePdf.error.message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => confirmDialog.current?.close()}>Cancel</button>
          <button className="btn" onClick={() => usePdf.mutate()} disabled={usePdf.isPending}>{usePdf.isPending ? 'Making PDF…' : 'Replace my PDF'}</button>
        </div>
      </dialog>
    </div>
  );
}

function ScorePanel({ score }) {
  const r = score.data;
  if (score.isError) return <Notice tone="error" className="">{score.error.message}</Notice>;
  if (!r) return <div className="panel h-48 animate-pulse" />;
  const tone = r.score == null ? 'text-muted' : r.score >= 75 ? 'text-ok' : r.score >= 50 ? 'text-marigold' : 'text-danger';
  return (
    <section className={`panel space-y-4 p-5 transition-opacity ${score.isFetching ? 'opacity-70' : ''}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Keyword match</h2>
          <p className="text-xs text-muted">Against {r.label}</p>
        </div>
        <span className={`text-3xl font-semibold ${tone}`}>{r.score == null ? '–' : `${r.score}%`}</span>
      </div>
      {r.score == null && <p className="text-sm text-muted">Run a job search first, so there are jobs to compare with.</p>}
      {r.missing.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Missing ({r.missing.length})</h3>
          <p className="mb-2 text-xs text-muted">Add only the ones you really use, in Skills or a bullet.</p>
          <div className="flex flex-wrap gap-1">
            <Chips items={r.missing} tone="bg-danger-soft text-danger" />
          </div>
        </div>
      )}
      {r.has.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Found ({r.has.length})</h3>
          <div className="flex flex-wrap gap-1">
            <Chips items={r.has} tone="bg-ok-soft text-ok" />
          </div>
        </div>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Format checks</h3>
        <Findings items={[...r.risks, ...r.checks].sort((a, b) => (a.level === 'ok') - (b.level === 'ok'))} />
      </div>
    </section>
  );
}

function SuggestionCard({ s, label, onAccept, onDismiss }) {
  const [text, setText] = useState(s.after);
  const [editing, setEditing] = useState(false);
  return (
    <article className="fade-in space-y-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md bg-cobalt-soft px-1.5 py-0.5 font-semibold text-cobalt">{s.kind === 'add' ? 'Add' : 'Rewrite'}</span>
        <span className="text-muted">{label}</span>
        {s.keyword && <span className="rounded-md bg-pink-soft px-1.5 py-0.5 text-pink">+ {s.keyword}</span>}
      </div>
      {s.before && <p className="text-sm text-faint line-through">{s.before}</p>}
      {editing ? (
        <textarea className="input text-sm" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      ) : (
        <p className="text-sm text-ink">{text}</p>
      )}
      <p className="text-xs text-muted">{s.reason}</p>
      {(s.needsConfirmation || s.warnings.length > 0) && (
        <p className="rounded-lg bg-marigold-soft px-2 py-1 text-xs text-ink">
          ⚠ Only accept if it’s true{s.warnings.length ? `: ${s.warnings.join('; ')}` : '.'}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onDismiss}>Dismiss</button>
        <button className="btn-ghost" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>
        <button className="btn-outline" onClick={() => onAccept(text.trim())} disabled={!text.trim()}>Accept</button>
      </div>
    </article>
  );
}
