import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { ApplyAnswers } from '../components/AutoApply.jsx';
import { PageHeader, TagInput } from '../components/ui.jsx';

const MODES = [
  ['remote', 'Remote'],
  ['hybrid', 'Hybrid'],
  ['onsite', 'On-site'],
];

const SITES = [
  ['freehire', 'freehire', 'Naukri, Shine, Hirist, Instahyre, Cutshort, Arc and more. Best for India.'],
  ['jsearch', 'JSearch', 'Indeed, Glassdoor and Foundit through Google Jobs. Needs JSEARCH_API_KEY on the server.'],
  ['remotive', 'Remotive', 'Remote jobs only. Checked at most once an hour.'],
  ['remoteok', 'Remote OK', 'Remote jobs only.'],
  ['himalayas', 'Himalayas', 'Remote jobs only.'],
  ['weworkremotely', 'We Work Remotely', 'Remote jobs only.'],
];

export default function PreferencesPage() {
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: () => api('/preferences') });
  return (
    <div>
      <PageHeader title="Preferences">
        Searches keep only the jobs that fit these settings. Empty lists allow anything.
      </PageHeader>
      {prefs.isPending && <p className="text-sm text-muted">Loading…</p>}
      {prefs.isError && <p className="text-sm text-danger">{prefs.error.message}</p>}
      {prefs.data && (
        // key: start a fresh draft whenever saved data changes
        <PreferencesForm key={prefs.dataUpdatedAt} initial={prefs.data} onSaved={(saved) => queryClient.setQueryData(['preferences'], saved)} />
      )}
      {/* separate from the form above: it has its own Save */}
      <section className="mt-10 grid gap-x-10 gap-y-4 border-t border-line py-8 md:grid-cols-[240px_1fr]">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">Auto-apply answers</h2>
          <p className="mt-1 help">What application forms ask that a resume doesn't say. Fill once.</p>
        </div>
        <ApplyAnswers />
      </section>
    </div>
  );
}

// One settings group: what it is on the left, the controls on the right.
function Section({ title, help, children }) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-t border-line py-8 first:border-t-0 first:pt-2 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 help">{help}</p>
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  );
}

function Field({ id, label, help, children }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {help && <p className="mb-1.5 text-xs text-muted">{help}</p>}
      {children}
    </div>
  );
}

// Empty box = no limit (null); otherwise a number.
function NumberInput({ id, value, onChange, placeholder }) {
  return (
    <input
      id={id}
      className="input"
      type="number"
      min="0"
      step="0.5"
      inputMode="decimal"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

// Platforms come from the jobs already in your feed, so the list only shows sites that actually have jobs for you.
const PLATFORM_NAMES = { weworkremotely: 'We Work Remotely', remoteok: 'Remote OK', smartrecruiters: 'SmartRecruiters', linkedin: 'LinkedIn' };
const platformName = (p) => PLATFORM_NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1);

function PlatformPicker({ value, onChange }) {
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api('/jobs/platforms') });
  if (platforms.isPending) return <p className="text-sm text-muted">Loading platforms…</p>;
  if (platforms.isError) return <p className="text-sm text-danger">{platforms.error.message}</p>;
  // keep ticked platforms visible even if no current job comes from them
  const all = [...platforms.data, ...value.filter((v) => !platforms.data.some((p) => p.platform === v)).map((platform) => ({ platform, count: 0 }))];
  if (!all.length) return <p className="text-sm text-muted">Run a search first; platforms appear here once jobs arrive.</p>;
  const toggle = (platform) => onChange(value.includes(platform) ? value.filter((v) => v !== platform) : [...value, platform]);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {all.map(({ platform, count }) => (
          <label
            key={platform}
            className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm text-muted select-none has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cobalt"
          >
            <input type="checkbox" className="sr-only" checked={value.includes(platform)} onChange={() => toggle(platform)} />
            {platformName(platform)} <span className="opacity-60">{count}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{value.length ? `Showing ${value.length} of ${all.length} platforms.` : 'Showing every platform.'}</p>
    </div>
  );
}

function PreferencesForm({ initial, onSaved }) {
  const [p, setP] = useState(initial);
  const set = (key) => (value) => setP({ ...p, [key]: value });
  const setBoards = (source) => (value) => setP({ ...p, companies: { ...p.companies, [source]: value } });
  const save = useMutation({ mutationFn: () => api('/preferences', { method: 'PUT', body: p }), onSuccess: onSaved });
  const toggleMode = (mode) => set('workModes')(p.workModes.includes(mode) ? p.workModes.filter((m) => m !== mode) : [...p.workModes, mode]);
  const dirty = p !== initial;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="panel px-6 sm:px-8">
        <Section title="Roles" help="Used as search words on job sites. A job title must contain one of them to reach your feed.">
          <Field id="roles" label="Role keywords" help="Press Enter or comma after each, e.g. mern, full stack, node, react.">
            <TagInput id="roles" value={p.roles} onChange={set('roles')} placeholder="Add a keyword" />
          </Field>
          <Field id="exclude" label="Leave out titles with" help="For example senior, lead, intern.">
            <TagInput id="exclude" value={p.excludeKeywords} onChange={set('excludeKeywords')} placeholder="Add a word" />
          </Field>
        </Section>

        <Section title="Where you'll work" help="Hybrid and on-site jobs must be in one of your places. Remote jobs follow the choice below.">
          <fieldset>
            <legend className="label">Work modes</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {MODES.map(([mode, label]) => (
                <label
                  key={mode}
                  className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm text-muted select-none has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cobalt"
                >
                  <input type="checkbox" className="sr-only" checked={p.workModes.includes(mode)} onChange={() => toggleMode(mode)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {p.workModes.includes('remote') && (
            <fieldset>
              <legend className="label">Remote jobs</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[
                  ['anywhere', 'From anywhere', 'Keep remote jobs open to any country.'],
                  ['myCountries', 'Only open to my countries', 'Keep remote jobs that hire in your countries below.'],
                ].map(([value, title, text]) => (
                  <label
                    key={value}
                    className="cursor-pointer rounded-xl border border-line p-3 has-[:checked]:border-ink has-[:checked]:ring-1 has-[:checked]:ring-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-cobalt"
                  >
                    <input type="radio" name="remoteScope" className="sr-only" checked={p.remoteScope === value} onChange={() => set('remoteScope')(value)} />
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="mt-0.5 block text-xs text-muted">{text}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="cities" label="Cities">
              <TagInput id="cities" value={p.cities} onChange={set('cities')} placeholder="e.g. Bengaluru" />
            </Field>
            <Field id="countries" label="Countries">
              <TagInput id="countries" value={p.countries} onChange={set('countries')} placeholder="e.g. India" />
            </Field>
          </div>
        </Section>

        <Section
          title="Pay, experience and freshness"
          help="These filter your feed straight away. Jobs that don't state their pay, years or date are still shown, since most Indian postings don't."
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="minSalary" label="Minimum pay" help="Lakhs a year (LPA)">
              <NumberInput id="minSalary" value={p.minSalaryLpa} onChange={set('minSalaryLpa')} placeholder="Any" />
            </Field>
            <Field id="years" label="Your experience" help="Years. Hides jobs asking for more than one extra.">
              <NumberInput id="years" value={p.yearsExperience} onChange={set('yearsExperience')} placeholder="Any" />
            </Field>
            <Field id="age" label="Posted within" help="Older jobs are hidden.">
              <select id="age" className="input" value={p.maxAgeDays} onChange={(e) => set('maxAgeDays')(Number(e.target.value))}>
                {[3, 7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Platforms" help="Show jobs only from the sites you tick. Leave all unticked to see every platform.">
          <PlatformPicker value={p.platforms} onChange={set('platforms')} />
        </Section>

        <Section title="Job sites" help="Searched with your role keywords and places. Remote-only sites run when Remote is on.">
          <ul className="divide-y divide-line rounded-xl border border-line">
            {SITES.map(([key, label, note]) => (
              <li key={key}>
                <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted">{note}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={p.sources[key]}
                    onChange={(e) => set('sources')({ ...p.sources, [key]: e.target.checked })}
                  />
                  {/* a switch drawn from the checkbox's state */}
                  <span className="relative h-5 w-9 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-cobalt after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-surface after:transition-transform peer-checked:after:translate-x-4" />
                </label>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Company job boards"
          help="Follow specific companies. The board name is the end of their careers address, like boards.greenhouse.io/stripe."
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="greenhouse" label="Greenhouse">
              <TagInput id="greenhouse" value={p.companies.greenhouse} onChange={setBoards('greenhouse')} placeholder="stripe" />
            </Field>
            <Field id="lever" label="Lever">
              <TagInput id="lever" value={p.companies.lever} onChange={setBoards('lever')} placeholder="spotify" />
            </Field>
            <Field id="ashby" label="Ashby">
              <TagInput id="ashby" value={p.companies.ashby} onChange={setBoards('ashby')} placeholder="ramp" />
            </Field>
          </div>
        </Section>
      </div>

      {/* Save bar: stays in view while there are unsaved changes */}
      <div className="sticky bottom-0 mt-6 -mx-4 flex items-center justify-end gap-4 border-t border-line bg-paper/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:bg-surface/95 sm:px-6">
        <span className="mr-auto text-sm" role="status">
          {save.isError ? (
            <span className="text-danger">{save.error.issues?.[0]?.message ?? save.error.message}</span>
          ) : dirty ? (
            <span className="text-marigold">You have unsaved changes</span>
          ) : save.isSuccess ? (
            <span className="text-ok">Preferences saved</span>
          ) : (
            <span className="text-muted">All changes saved</span>
          )}
        </span>
        {dirty && (
          <button type="button" className="btn-ghost" onClick={() => setP(initial)}>
            Discard
          </button>
        )}
        <button className="btn" disabled={save.isPending || !dirty}>
          {save.isPending ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </form>
  );
}
