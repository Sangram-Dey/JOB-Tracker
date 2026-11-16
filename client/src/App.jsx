import { Show, SignIn, UserButton } from '@clerk/react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import ProfilePage from './pages/ProfilePage.jsx';
import PreferencesPage from './pages/PreferencesPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import EmailPage from './pages/EmailPage.jsx';
import { Icon } from './components/ui.jsx';

const PAGES = {
  jobs: ['Jobs', JobsPage],
  email: ['Email', EmailPage],
  preferences: ['Preferences', PreferencesPage],
  profile: ['Profile', ProfilePage],
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
      <span className="grid size-8 place-items-center rounded-lg bg-ink font-display text-base font-semibold text-surface">
        J<span className="text-marigold">.</span>
      </span>
      <span className="font-display text-lg font-semibold tracking-tight">Job Tracker</span>
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

function NavItem({ id, label, active, onClick, compact }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? 'bg-sunken font-medium text-ink' : 'text-muted hover:bg-sunken hover:text-ink'
      }`}
    >
      {/* marigold bar marks where you are */}
      {active && !compact && <span className="absolute top-2 bottom-2 -left-4 w-1 rounded-r bg-marigold" />}
      <Icon name={id} />
      {label}
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

  return (
    <>
      {/* Clerk's ready-made screen. withSignUp: new emails sign up right here instead of on Clerk's hosted page. */}
      <Show when="signed-out">
        <div className="grid min-h-screen lg:grid-cols-2">
          <div className="hidden flex-col justify-between bg-ink p-12 text-surface lg:flex">
            <span className="font-display text-lg font-semibold">
              Job Tracker<span className="text-marigold">.</span>
            </span>
            <div className="max-w-md">
              <p className="font-display text-4xl leading-tight font-semibold tracking-tight">
                Every job that fits you, from Naukri to remote boards, in one feed.
              </p>
              <p className="mt-4 text-base opacity-70">
                Upload your resume once, set where and how you want to work, and new matches arrive every six hours.
              </p>
            </div>
            <span className="text-sm opacity-50">Your personal job search desk</span>
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
        <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
          {/* Desktop: sidebar */}
          <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
            <Brand />
            <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
              {Object.entries(PAGES).map(([key, [label]]) => (
                <NavItem key={key} id={key} label={label} active={page === key} onClick={() => setPage(key)} />
              ))}
            </nav>
            <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
              <ThemeToggle withLabel />
              <UserButton />
            </div>
          </aside>

          {/* Mobile: top bar */}
          <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between">
              <Brand />
              <div className="flex items-center gap-1">
                <ThemeToggle />
                <UserButton />
              </div>
            </div>
            <nav className="mt-3 flex gap-1 overflow-x-auto" aria-label="Main">
              {Object.entries(PAGES).map(([key, [label]]) => (
                <NavItem key={key} id={key} label={label} active={page === key} onClick={() => setPage(key)} compact />
              ))}
            </nav>
          </header>

          <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 lg:py-10">
            <Page onNavigate={setPage} />
          </main>
        </div>
      </Show>
    </>
  );
}
