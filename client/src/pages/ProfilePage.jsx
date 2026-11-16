import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import FieldEditor from '../components/FieldEditor.jsx';
import { Icon, PageHeader, timeAgo } from '../components/ui.jsx';
import { ResumeCheck } from '../components/AtsCheck.jsx';

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api('/profile') });
  const onSaved = (saved) => queryClient.setQueryData(['profile'], saved);

  const upload = useMutation({
    mutationFn: (file) => {
      const form = new FormData();
      form.append('resume', file);
      return api('/profile/upload', { method: 'POST', body: form });
    },
    onSuccess: onSaved,
  });

  function onFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (profile.data?.data && !confirm('Replace your current profile, including your edits, with this resume?')) return;
    upload.mutate(file);
  }

  const data = profile.data?.data;
  return (
    <div>
      <PageHeader title="Profile">
        Our intelligence reads your resume and turns it into structured data. Check it and fix anything wrong: job ranking and
        application emails only use facts from this profile.
      </PageHeader>
      {profile.isPending && <p className="text-sm text-muted">Loading…</p>}
      {profile.isError && <p className="text-sm text-danger">{profile.error.message}</p>}

      {profile.data !== undefined && (
        <div className="grid items-start gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="panel space-y-5 p-5 lg:sticky lg:top-10">
            {data ? (
              <div>
                <p className="font-display text-xl font-semibold tracking-tight">{data.contact?.name || 'Your name'}</p>
                {data.headline && <p className="mt-0.5 text-sm text-muted">{data.headline}</p>}
                <dl className="mt-4 space-y-1 text-sm">
                  {[data.contact?.email, data.contact?.phone, data.contact?.location].filter(Boolean).map((v) => (
                    <dd key={v} className="truncate text-muted">
                      {v}
                    </dd>
                  ))}
                </dl>
              </div>
            ) : (
              <div>
                <p className="font-display text-xl font-semibold tracking-tight">Start with your resume</p>
                <p className="mt-1 text-sm text-muted">Upload it once. Searches, ranking and application emails all build on it.</p>
              </div>
            )}

            <label
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-6 text-center hover:border-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cobalt ${upload.isPending ? 'opacity-60' : ''}`}
            >
              <Icon name="upload" className="size-5 text-muted" />
              <span className="text-sm font-medium">
                {upload.isPending ? 'Reading your resume…' : data ? 'Upload a new resume' : 'Choose a PDF or DOCX'}
              </span>
              <span className="text-xs text-faint">Up to 5 MB</span>
              <input type="file" accept=".pdf,.docx" className="sr-only" onChange={onFile} disabled={upload.isPending} />
            </label>
            {upload.isError && <p className="text-sm text-danger">{upload.error.message}</p>}

            {profile.data?.sourceFileName && (
              <p className="border-t border-line pt-4 text-xs text-faint">
                From {profile.data.sourceFileName}, updated {timeAgo(profile.data.updatedAt)}
              </p>
            )}
            <ResumePdf pdf={profile.data?.resumePdf} onSaved={onSaved} />
          </aside>

          {data ? (
            <div className="min-w-0 space-y-6">
              {profile.data.resumePdf?.id && <ResumeCheck key={profile.data.resumePdf.id} />}
              {/* key: remount the editor (fresh draft) whenever a new version is saved or uploaded */}
              <ProfileEditor key={profile.data.updatedAt} initial={data} onSaved={onSaved} />
            </div>
          ) : (
            <div className="panel hidden px-6 py-16 text-center text-sm text-muted lg:block">Your profile appears here after the upload.</div>
          )}
        </div>
      )}
    </div>
  );
}

// The PDF that every application email attaches. Separate from the upload above, which only fills in your profile.
function ResumePdf({ pdf, onSaved }) {
  const upload = useMutation({
    mutationFn: (file) => {
      const form = new FormData();
      form.append('pdf', file);
      return api('/profile/resume-pdf', { method: 'PUT', body: form });
    },
    onSuccess: onSaved,
  });
  const open = useMutation({
    mutationFn: () => api('/profile/resume-pdf', { blob: true }),
    onSuccess: (blob) => window.open(URL.createObjectURL(blob), '_blank'),
  });
  const error = upload.error ?? open.error;

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <p className="text-sm font-medium">Resume attached to emails</p>
      {pdf?.id ? (
        <button className="flex items-center gap-2 text-left text-sm text-cobalt hover:underline" onClick={() => open.mutate()}>
          <Icon name="resumes" className="size-4 shrink-0" />
          <span className="truncate">{pdf.name}</span>
          <span className="shrink-0 text-xs text-faint">{Math.round(pdf.size / 1024)} KB</span>
        </button>
      ) : (
        <p className="text-xs text-marigold">None yet. Upload one before writing application emails.</p>
      )}
      <label className={`btn-ghost cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cobalt ${upload.isPending ? 'opacity-60' : ''}`}>
        <Icon name="upload" />
        {upload.isPending ? 'Uploading…' : pdf?.id ? 'Replace PDF' : 'Upload PDF'}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (file) upload.mutate(file);
          }}
        />
      </label>
      <p className="text-xs text-faint">PDF only, up to 2 MB</p>
      {error && <p className="text-sm text-danger">{error.message}</p>}
    </div>
  );
}

function ProfileEditor({ initial, onSaved }) {
  const [draft, setDraft] = useState(initial);
  const save = useMutation({
    mutationFn: () => api('/profile', { method: 'PUT', body: { data: draft } }),
    onSuccess: onSaved,
  });
  const dirty = draft !== initial;

  return (
    <div className="min-w-0">
      <div className="panel px-6 sm:px-8">
        <FieldEditor value={draft} onChange={setDraft} />
      </div>
      <div className="sticky bottom-0 mt-6 -mx-4 flex items-center justify-end gap-4 border-t border-line bg-paper/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-surface/95 sm:px-6">
        <span className="mr-auto text-sm" role="status">
          {save.isError ? (
            <span className="text-danger">{save.error.message}</span>
          ) : dirty ? (
            <span className="text-marigold">You have unsaved changes</span>
          ) : (
            <span className="text-muted">All changes saved</span>
          )}
        </span>
        {dirty && (
          <button className="btn-ghost" onClick={() => setDraft(initial)}>
            Discard
          </button>
        )}
        <button className="btn" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
