import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Icon, Instructions, Notice, Stepper, goToSettings, toast } from './ui.jsx';

// Settings > Sending email: your "apply email". HR emails go from it, the Tracker reads its replies, and auto-apply
// forms use it. Gmail or Yahoo Mail, connected with an app password. `compact` = a one-line notice for other pages.
// Server side: server/src/mail/providers.js (same ids) and PUT /api/profile/mail.
const PROVIDERS = {
  gmail: {
    name: 'Gmail',
    domains: /@(gmail|googlemail)\.com$/i,
    url: 'https://myaccount.google.com/apppasswords',
    urlLabel: 'Open Google app passwords',
    steps: ['Turn on 2-Step Verification in your Google Account (Security) if it is off.', 'Open Google app passwords, type the name "Job Tracker" and press Create.', 'Copy the 16-letter password Google shows. You only see it once.'],
  },
  yahoo: {
    name: 'Yahoo Mail',
    domains: /@(yahoo|ymail|rocketmail)\.[a-z.]+$/i,
    url: 'https://login.yahoo.com/account/security/app-passwords',
    urlLabel: 'Open Yahoo app passwords',
    steps: ['Open Yahoo Account security, then "Generate app password" (sign in if asked).', 'Type the name "Job Tracker" and press Generate.', 'Copy the 16-letter password Yahoo shows. You only see it once.'],
  },
};
const providerFor = (email) => Object.keys(PROVIDERS).find((id) => PROVIDERS[id].domains.test(email)) ?? null;

const FAQ = [
  ["I don't see App passwords", '2-Step Verification is off, or it is a work or school account whose admin blocks app passwords, or Advanced Protection is on. Turn on 2-Step Verification, or use a personal Gmail or Yahoo address.'],
  ['It worked before, now it fails', 'Changing your Google or Yahoo password cancels its app passwords. Create a new one and use Replace email.'],
  ['Can I use Outlook or Hotmail?', 'Not yet. Microsoft no longer allows app passwords, so it needs "Sign in with Microsoft", planned for later.'],
  ['Is my password safe?', 'It is checked with your provider, stored encrypted, and never shown again. You can revoke it in your Google or Yahoo account at any time, which stops this app at once.'],
];

export function useMailStatus() {
  return useQuery({ queryKey: ['outboxStatus'], queryFn: () => api('/outreach/status') });
}

export function MailAccount({ compact = false, onNavigate }) {
  const status = useMailStatus();
  const [replacing, setReplacing] = useState(false);
  const s = status.data;

  if (compact) {
    return s && !s.from ? (
      <Notice tone="warning" action={onNavigate && <button className="btn-outline" onClick={() => goToSettings(onNavigate, 'email')}>Connect email</button>}>
        <strong className="font-semibold">No apply email connected.</strong> Emails can be written and checked, but not sent, and replies aren't tracked. Connect your
        Gmail or Yahoo Mail in Settings &gt; Sending email.
      </Notice>
    ) : null;
  }
  if (status.isPending) return <div className="skeleton h-24 rounded-lg" />;

  return (
    <div className="space-y-6 text-sm">
      {s?.from && !replacing ? <Connected status={s} onReplace={() => setReplacing(true)} /> : <ConnectGuide current={s?.from} onDone={() => setReplacing(false)} onCancel={s?.from ? () => setReplacing(false) : null} />}
      <details className="group rounded-lg border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
          <Icon name="info" className="size-4 text-cobalt" />
          Having trouble?
          <Icon name="chevron" className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <dl className="space-y-3 border-t border-line px-4 py-3">
          {FAQ.map(([q, a]) => (
            <div key={q}>
              <dt className="font-semibold text-ink">{q}</dt>
              <dd className="mt-0.5 text-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

// Connected: which email, since when, and what you can do with it.
function Connected({ status, onReplace }) {
  const queryClient = useQueryClient();
  const testDialog = useRef(null);
  const disconnect = useMutation({
    meta: { success: 'Apply email disconnected' },
    mutationFn: () => api('/profile/mail', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['outboxStatus'] }),
  });
  const testMail = useMutation({
    meta: { inline: true },
    mutationFn: (to) => api('/outreach/test', { method: 'POST', body: { to } }),
    onSuccess: (d) => (testDialog.current?.close(), toast(`Test email sent to ${d.sentTo}${d.withResume ? ' with your resume' : ' (no resume PDF yet)'}. Check that inbox.`)),
  });
  const provider = PROVIDERS[status.provider] ?? PROVIDERS.gmail;
  return (
    <>
      <div className="rounded-lg border border-ok/30 bg-ok-soft px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ok">
            <Icon name="check" className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wider text-ok uppercase">Apply email · {provider.name}</p>
            <p className="truncate text-base font-semibold text-ink">{status.from}</p>
            {status.connectedAt && <p className="text-xs text-muted">Connected on {new Date(status.connectedAt).toLocaleDateString()}</p>}
          </div>
        </div>
        <p className="mt-3 text-ink">HR emails go from this address, replies to it update your Tracker, and auto-apply forms use it.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn" onClick={() => (testMail.reset(), testDialog.current?.showModal())}>
            <Icon name="mail" />
            Send test email
          </button>
          <button className="btn-outline" onClick={onReplace}>
            <Icon name="edit" />
            Replace email
          </button>
          <button className="btn-danger ml-auto" onClick={() => confirm(`Disconnect ${status.from}? Emails can't be sent until you connect one again.`) && disconnect.mutate()} disabled={disconnect.isPending}>
            Disconnect
          </button>
        </div>
      </div>

      <dialog ref={testDialog} className="dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            testMail.mutate(new FormData(e.currentTarget).get('to'));
          }}
        >
          <h2 className="section-title">Send a test email</h2>
          <p className="section-desc">It goes from {status.from} to the address you type, with your resume attached. It doesn't count toward your daily limit.</p>
          <label className="label mt-4" htmlFor="test-to">
            Send to
          </label>
          {/* key: a fresh, empty field every time the popup opens */}
          <input key={testMail.submittedAt} id="test-to" name="to" type="email" required autoFocus autoComplete="off" placeholder="you@example.com" className="input mt-1" />
          {testMail.isError && <p className="mt-2 text-sm text-danger">{testMail.error.message}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => testDialog.current?.close()}>
              Cancel
            </button>
            <button className="btn" disabled={testMail.isPending}>
              {testMail.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

// Not connected, or replacing: choose provider -> create an app password -> connect.
function ConnectGuide({ current, onDone, onCancel }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState(null);
  const [form, setForm] = useState({ user: '', pass: '' });
  const p = PROVIDERS[provider];
  const connect = useMutation({
    meta: { inline: true, success: (r) => `${PROVIDERS[r.provider].name} connected: emails now go from ${r.user}` },
    mutationFn: () => api('/profile/mail', { method: 'PUT', body: { ...form, provider } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outboxStatus'] });
      queryClient.invalidateQueries({ queryKey: ['tracker'] });
      onDone();
    },
  });
  const typed = (user) => {
    setForm({ ...form, user });
    const guess = providerFor(user);
    if (guess) setProvider(guess);
  };
  const steps = [
    {
      title: 'Choose your email provider',
      done: Boolean(provider),
      content: (
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(PROVIDERS).map(([id, x]) => (
            <button
              key={id}
              type="button"
              onClick={() => setProvider(id)}
              aria-pressed={provider === id}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${provider === id ? 'border-cobalt bg-cobalt-soft' : 'border-line hover:border-cobalt/50'}`}
            >
              <span className={`grid size-5 place-items-center rounded-full border-2 ${provider === id ? 'border-cobalt' : 'border-line'}`}>{provider === id && <span className="size-2.5 rounded-full bg-cobalt" />}</span>
              <span>
                <span className="block font-semibold text-ink">{x.name}</span>
                <span className="block text-xs text-muted">{id === 'gmail' ? '@gmail.com and Google accounts' : '@yahoo.com, @ymail.com'}</span>
              </span>
            </button>
          ))}
          <p className="text-xs text-faint sm:col-span-2">Outlook and Hotmail aren't supported yet (see "Having trouble?" below).</p>
        </div>
      ),
    },
    {
      title: 'Create an app password',
      done: form.pass.replace(/\s/g, '').length === 16,
      content: p ? (
        <div className="space-y-3">
          <Instructions title={`How to, in ${p.name}`} steps={p.steps} />
          <a className="btn-outline" href={p.url} target="_blank" rel="noreferrer">
            <Icon name="external" />
            {p.urlLabel}
          </a>
          <p className="rounded-lg bg-marigold-soft px-3 py-2 text-ink">
            <strong className="font-semibold">Not your normal password.</strong> An app password only lets this app send and read mail, and you can revoke it any time.
          </p>
        </div>
      ) : (
        <p className="text-muted">Choose a provider first.</p>
      ),
    },
    {
      title: current ? 'Connect your new email' : 'Connect',
      done: false,
      content: (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            connect.mutate();
          }}
        >
          {current && <p className="text-muted">Your current email ({current}) keeps working until the new one is checked and connected.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="label">Email address</span>
              <input className="input mt-1" type="email" required autoComplete="email" placeholder={provider === 'yahoo' ? 'you@yahoo.com' : 'you@gmail.com'} value={form.user} onChange={(e) => typed(e.target.value)} />
            </label>
            <label>
              <span className="label">App password</span>
              <input className="input mt-1 font-mono tracking-wider" type="password" required autoComplete="new-password" placeholder="abcd efgh ijkl mnop" value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} />
              <span className="mt-1 block text-xs text-faint">16 letters; spaces are fine.</span>
            </label>
          </div>
          {connect.isError && <p className="text-danger">{connect.error.issues?.[0]?.message ?? connect.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={connect.isPending || !provider}>
              <Icon name="mail" />
              {connect.isPending ? `Checking with ${p?.name ?? 'your provider'}…` : current ? 'Replace email' : 'Connect email'}
            </button>
            {onCancel && (
              <button type="button" className="btn-ghost" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ),
    },
  ];
  return <Stepper steps={steps} />;
}
