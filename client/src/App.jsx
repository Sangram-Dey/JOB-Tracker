import { Show, SignIn, UserButton } from '@clerk/react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import ProfilePage from './pages/ProfilePage.jsx';
import PreferencesPage from './pages/PreferencesPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import EmailPage from './pages/EmailPage.jsx';
import TrackerPage from './pages/TrackerPage.jsx';
import ResumePage from './pages/ResumePage.jsx';
import { Icon, Toaster } from './components/ui.jsx';

// [label, page, one-line purpose shown under the label in the sidebar, icon (default: the key)]
const PAGES = {
  jobs: ['Jobs', JobsPage, 'Find and apply'],
  email: ['Email', EmailPage, 'Write to HR'],
  tracker: ['Tracker', TrackerPage, 'Your applications'],
  resumes: ['Resume', ResumePage, 'Improve for ATS'],
  preferences: ['Preferences', PreferencesPage, 'What to search for'],
  profile: ['Settings', ProfilePage, 'Profile, resume, email', 'settings'],
};

// The last page you had open, so a reload doesn't send you elsewhere. Storage can be blocked, hence the try.
// shortcut: no URLs per page yet; add react-router when pages need shareable links.
const remembered = () => {
  try {
    return PAGES[localStorage.page] ? localStorage.page : 'jobs';
  } catch {
    return 'jobs';
  }
};

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-lg bg-cobalt text-base font-bold text-on-accent">J</span>
      <span className="leading-tight">
        <span className="block text-base font-semibold tracking-tight">Job Tracker</span>
        <span className="block text-xs text-muted">AI job search desk</span>
      </span>
    </div>
  );
}

// resolvedTheme is what's showing now ("light" or "dark"), even when the choice is "system".
function ThemeToggle({ withLabel }) {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="btn-ghost" onClick={() => setTheme(next)} aria-label={`Switch to ${next} mode`}>
      <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} />
      {withLabel && <span>{next === 'dark' ? 'Dark mode' : 'Light mode'}</span>}
    </button>
  );
}

function NavItem({ icon, label, hint, active, onClick, compact }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
        active ? 'bg-cobalt-soft text-cobalt' : 'text-muted hover:bg-sunken hover:text-ink'
      }`}
    >
      {active && !compact && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-cobalt" aria-hidden="true" />}
      <Icon name={icon} className="size-[18px] shrink-0" />
      <span className="leading-tight">
        <span className="block font-semibold">{label}</span>
        {!compact && <span className={`block text-xs ${active ? 'text-cobalt' : 'text-faint group-hover:text-muted'}`}>{hint}</span>}
      </span>
    </button>
  );
}

export default function App() {
  const [page, setPageState] = useState(remembered);
  const setPage = (key) => {
    setPageState(key);
    try {
      localStorage.page = key;
    } catch {}
  };
  const Page = PAGES[page][1];
  const nav = (compact) =>
    Object.entries(PAGES).map(([key, [label, , hint, icon]]) => (
      <NavItem key={key} id={key} icon={icon ?? key} label={label} hint={hint} active={page === key} onClick={() => setPage(key)} compact={compact} />
    ));

  return (
    <>
      {/* Clerk's ready-made screen. withSignUp: new emails sign up right here instead of on Clerk's hosted page. */}
      <Show when="signed-out">
        <div className="grid min-h-screen lg:grid-cols-2">
          {/* Ink panel with the product in three lines; fixed colours, so it looks the same in light and dark */}
          <div className="hidden flex-col justify-between bg-[#0f1b24] p-12 text-[#e6eef1] lg:flex">
            <span className="flex items-center gap-2.5 text-base font-semibold">
              <span className="grid size-9 place-items-center rounded-lg bg-[#2dd4bf] font-bold text-[#0b1418]">J</span>
              Job Tracker
            </span>
            <div className="max-w-md">
              <p className="text-4xl leading-tight font-semibold tracking-tight">Every job that fits you, from Naukri to remote boards, in one feed.</p>
              <ul className="mt-8 space-y-3 text-base text-[#a3b3ba]">
                {['AI scores each job against your profile', 'Writes HR emails and tailors your resume for each job', 'Fills application forms; you approve before anything goes out'].map((t) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[#2dd4bf]" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <span className="text-sm text-[#879aa2]">Your personal AI job search desk</span>
          </div>
          <div className="relative flex items-center justify-center px-4 py-12">
            <div className="absolute top-4 right-4">
              <ThemeToggle />
            </div>
            <SignIn routing="hash" withSignUp />
          </div>
        </div>
      </Show>

      <Show when="signed-in">
        <div className="min-h-screen lg:grid lg:grid-cols-[256px_1fr]">
          {/* Desktop: sidebar */}
          <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
            <Brand />
            <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
              {nav(false)}
            </nav>
            <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
              <ThemeToggle withLabel />
              <UserButton />
            </div>
          </aside>

          {/* Mobile: top bar */}
          <header className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3 lg:hidden">
            <div className="flex items-center justify-between">
              <Brand />
              <div className="flex items-center gap-1">
                <ThemeToggle />
                <UserButton />
              </div>
            </div>
            <nav className="mt-3 flex gap-1 overflow-x-auto pb-1" aria-label="Main">
              {nav(true)}
            </nav>
          </header>

          <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 lg:py-10">
            <div key={page} className="fade-in">
              <Page onNavigate={setPage} />
            </div>
          </main>
        </div>
      </Show>
      <Toaster />
    </>
  );
}
