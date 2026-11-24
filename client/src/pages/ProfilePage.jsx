import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Instructions, Notice, PageHeader, SectionCard, Tabs, useStoredState } from '../components/ui.jsx';
import { ApplyAnswers } from '../components/AutoApply.jsx';
import { MailAccount, useMailStatus } from '../components/MailAccount.jsx';
import { ResumeTab } from '../components/profile/ResumeTab.jsx';
import { DetailsTab } from '../components/profile/DetailsTab.jsx';

// Settings, in four tabs so each part is small: your profile details, the resume file they're read from,
// apply requirements (standard form answers), and the Gmail emails go from. The dot on each tab says whether it's done.
export default function ProfilePage() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api('/profile') });
  const answers = useQuery({ queryKey: ['applyAnswers'], queryFn: () => api('/apply/answers') });
  const mail = useMailStatus();
  const [tab, setTab] = useStoredState('settingsTab', 'details');
  const onSaved = (saved) => queryClient.setQueryData(['profile'], saved);

  const p = profile.data;
  const tabs = [
    { id: 'details', label: 'Profile details', icon: 'profile', done: Boolean(p?.data), hint: 'Your contact, skills, experience, education and projects. Job matching, emails and forms use only these facts.' },
    { id: 'resume', label: 'Resume', icon: 'resumes', done: Boolean(p?.resumePdf?.id), hint: 'The PDF attached to HR emails and uploaded to forms, and its ATS check.' },
    { id: 'answers', label: 'Apply requirements', icon: 'list', done: Object.values(answers.data ?? {}).some(Boolean), hint: 'Notice period, pay, work authorization and other answers forms ask that a resume does not say.' },
    { id: 'email', label: 'Sending email', icon: 'mail', done: Boolean(mail.data?.from), hint: 'Your apply email (Gmail or Yahoo): HR emails go from it, replies are tracked, and forms use it.' },
  ];

  return (
    <div>
      <PageHeader title="Settings">Everything the app knows about you. Fill each tab once: a green dot means done. Hover a tab to see what it is for.</PageHeader>
      {profile.isPending && <div className="skeleton h-40 rounded-xl" />}
      {profile.isError && <Notice tone="error">{profile.error.message}</Notice>}
      {profile.isSuccess && (
        <>
          {p?.data && <Summary data={p.data} />}
          <Tabs label="Settings sections" tabs={tabs} value={tab} onChange={setTab} />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={tab} className="fade-in">
            {tab === 'resume' && <ResumeTab profile={p} onSaved={onSaved} />}
            {tab === 'details' &&
              (p?.data ? (
                // key: unsaved text edits start fresh when a new resume is uploaded (not on every save)
                <DetailsTab key={p.sourceFileName ?? 'profile'} saved={p.data} onSaved={onSaved} />
              ) : (
                <Notice tone="info" action={<button className="btn-outline" onClick={() => setTab('resume')}>Go to Resume</button>}>
                  Upload your resume on the Resume tab first. Your profile details are read from it; then check and edit them here.
                </Notice>
              ))}
            {tab === 'answers' && (
              <SectionCard
                title="Apply requirements"
                description="Answers application forms ask that a resume doesn't say. Auto-apply uses only these and your details."
                instructions={<Instructions title="Tip">Write them as you'd type them on a form. Anything left blank is left for you to answer on each application.</Instructions>}
              >
                <ApplyAnswers />
              </SectionCard>
            )}
            {tab === 'email' && (
              <SectionCard
                title="Sending email"
                description="Connect, test or replace your apply email. It takes about two minutes."
              >
                <MailAccount />
              </SectionCard>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const href = (link) => (/^https?:\/\//i.test(link) ? link : `https://${link}`);
const short = (link) => link.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

// Who you are at a glance: initials, name, headline, contact and links in one line.
function Summary({ data }) {
  const c = data.contact ?? {};
  const initials = (c.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const facts = [c.email, c.phone, c.location].filter(Boolean);
  const links = [c.linkedin, c.github, c.portfolio].filter(Boolean);
  return (
    <div className="panel mb-6 flex flex-wrap items-center gap-4 px-5 py-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-cobalt-soft text-base font-semibold text-cobalt">{initials}</span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-semibold tracking-tight">{c.name || 'Your name'}</p>
        {data.headline && <p className="text-sm text-muted">{data.headline}</p>}
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {facts.map((f) => (
            <span key={f}>{f}</span>
          ))}
          {links.map((l) => (
            <a key={l} href={href(l)} target="_blank" rel="noreferrer" className="text-cobalt hover:underline">
              {short(l)}
            </a>
          ))}
        </p>
      </div>
    </div>
  );
}
