import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api.js';
import { Icon, Instructions, SectionCard, timeAgo } from '../ui.jsx';
import { ResumeCheck } from '../AtsCheck.jsx';

// Settings > Resume: the PDF that emails and applications attach, and the ATS check of it.
const STEPS = [
  'Upload your resume as a PDF (up to 2 MB). Export it from Word or Google Docs, not a scan.',
  'AI reads it into your profile in about half a minute. Check the result on the Profile details tab.',
  'Run the ATS check below to see how applicant-tracking systems read it.',
];

export function ResumeTab({ profile, onSaved }) {
  const upload = useMutation({
    meta: { inline: true, success: 'Resume uploaded and read' },
    mutationFn: (file) => {
      const form = new FormData();
      form.append('resume', file);
      return api('/profile/upload', { method: 'POST', body: form });
    },
    onSuccess: onSaved,
  });
  const seconds = useElapsed(upload.isPending);
  const pdf = profile?.resumePdf;

  function onFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (profile?.data && !confirm('Replace your current profile, including your edits, with this resume?')) return;
    upload.mutate(file);
  }
  const fileInput = <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={onFile} disabled={upload.isPending} />;
  const status = upload.isPending ? `Reading your resume… ${seconds} s` : null;

  return (
    <div className="space-y-6">
      <SectionCard
        title="Resume file"
        description="The PDF attached to your HR emails and uploaded to application forms. Your profile details are read from it."
        instructions={!pdf?.id && <Instructions steps={STEPS} />}
      >
        {pdf?.id ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3">
              <Icon name="resumes" className="size-6 shrink-0 text-cobalt" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={pdf.name}>
                  {pdf.name}
                </p>
                <p className="text-xs text-faint">
                  {Math.round(pdf.size / 1024)} KB · added {timeAgo(pdf.savedAt)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <OpenPdf />
              <label className={`btn-outline cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cobalt ${upload.isPending ? 'opacity-60' : ''}`}>
                <Icon name="upload" />
                <span aria-live="polite">{status ?? 'Replace PDF'}</span>
                {fileInput}
              </label>
            </div>
          </div>
        ) : (
          <label
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line px-4 py-10 text-center transition hover:border-cobalt has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cobalt ${upload.isPending ? 'opacity-60' : ''}`}
          >
            <span className="grid size-11 place-items-center rounded-full bg-cobalt-soft text-cobalt">
              <Icon name="upload" className="size-5" />
            </span>
            <span className="text-sm font-semibold" aria-live="polite">
              {status ?? 'Click to upload your resume'}
            </span>
            <span className="text-xs text-faint">PDF, up to 2 MB</span>
            {fileInput}
          </label>
        )}
        {upload.isError && <p className="text-sm text-danger">{upload.error.message}</p>}
      </SectionCard>
      {pdf?.id && <ResumeCheck key={pdf.id} />}
    </div>
  );
}

// Opens the stored PDF in a new tab. Fetched with the login token (a plain link can't send it), shown from a blob URL.
function OpenPdf() {
  const [error, setError] = useState(null);
  async function open() {
    setError(null);
    const tab = window.open('', '_blank'); // opened on the click itself, so popup blockers allow it
    try {
      const blob = await api('/profile/resume-pdf', { blob: true });
      if (tab) tab.location.href = URL.createObjectURL(blob);
    } catch (err) {
      tab?.close();
      setError(err.message);
    }
  }
  return (
    <>
      <button type="button" className="btn-ghost" onClick={open}>
        <Icon name="external" />
        Open
      </button>
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </>
  );
}

// Seconds since `running` became true, so a long upload visibly keeps working.
function useElapsed(running) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}
