import { Icon } from './ui.jsx';

// A recursive form: it looks at the shape of the value and renders the right input.
//   string           -> text input (textarea for long text)
//   list of strings  -> textarea, one item per line
//   list of objects  -> a card per item, with Add / Remove
//   object           -> a group with one field per key
// So the whole profile is editable without writing a form per section.

// Blank items for "Add" buttons. Must match server/src/schemas/profile.js.
const BLANK = {
  experience: { company: '', title: '', location: '', startDate: '', endDate: '', bullets: [] },
  education: { institution: '', degree: '', field: '', startDate: '', endDate: '', grade: '' },
  projects: { name: '', description: '', link: '', tech: [], bullets: [] },
};
const LONG_TEXT = ['summary', 'description'];
// Singular names for "Add …" buttons.
const ITEM = { experience: 'role', education: 'education', projects: 'project' };

const LABELS = { contact: 'Contact & links', linkedin: 'LinkedIn', github: 'GitHub', portfolio: 'Portfolio / website', links: 'Other links' };
const pretty = (key) => LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
const isGroup = (v) => typeof v === 'object' && v !== null && !(Array.isArray(v) && v.every((x) => typeof x === 'string'));

// bare: no collapsible section heading around this part (used when a card or tab already names it).
export default function FieldEditor({ name, value, onChange, depth = 0, bare = false }) {
  const label = name && pretty(name);
  const wrap = (content, count) => (bare ? content : <Section id={name} label={label} count={count}>{content}</Section>);

  if (typeof value === 'string') {
    const long = LONG_TEXT.includes(name);
    const Tag = long ? 'textarea' : 'input';
    return (
      <label className={`block ${long ? 'sm:col-span-2' : ''}`}>
        <span className="text-xs font-medium text-muted">{label}</span>
        <Tag className="input mt-1" rows={5} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }

  if (Array.isArray(value) && !BLANK[name]) {
    return (
      <label className="block sm:col-span-2">
        <span className="text-xs font-medium text-muted">{label}</span> <span className="text-xs text-faint">(one per line)</span>
        <textarea
          className="input mt-1"
          rows={Math.min(Math.max(value.length + 1, 3), 12)}
          value={value.join('\n')}
          onChange={(e) => onChange(e.target.value.split('\n'))}
          // drop empty lines once you leave the box, so stray blank lines don't get saved
          onBlur={() => onChange(value.map((s) => s.trim()).filter(Boolean))}
        />
      </label>
    );
  }

  if (Array.isArray(value)) {
    return wrap(
        <div className="space-y-3">
          {value.map((item, i) => (
            <div key={i} className="rounded-lg border border-line bg-paper p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldEditor value={item} depth={depth + 1} onChange={(v) => onChange(value.with(i, v))} />
              </div>
              <div className="mt-3 flex justify-end">
                <button type="button" className="btn-ghost text-danger hover:text-danger" onClick={() => onChange(value.toSpliced(i, 1))}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn-outline" onClick={() => onChange([...value, BLANK[name]])}>
            Add {ITEM[name] ?? name}
          </button>
        </div>,
      value.length,
    );
  }

  const entries = Object.entries(value);
  const field = ([key, v]) => (
    <FieldEditor key={key} name={key} value={v} depth={depth + 1} onChange={(nv) => onChange({ ...value, [key]: nv })} />
  );

  // The whole profile: groups (Contact, Experience…) are sections; plain fields (Headline, Summary, Skills) share one.
  if (depth === 0) {
    const plain = entries.filter(([, v]) => !isGroup(v));
    return (
      <div className="divide-y divide-line">
        {entries.filter(([key, v]) => isGroup(v) && key === 'contact').map(field)}
        {plain.length > 0 && (
          <Section id="about" label="About you">
            <div className="grid gap-3 sm:grid-cols-2">{plain.map(field)}</div>
          </Section>
        )}
        {entries.filter(([key, v]) => isGroup(v) && key !== 'contact').map(field)}
      </div>
    );
  }
  if (!name) return entries.map(field); // an item inside a list card
  return wrap(<div className="grid gap-3 sm:grid-cols-2">{entries.map(field)}</div>);
}

// A collapsible profile section. Long lists that matter less while applying start closed.
const CLOSED = ['projects'];
function Section({ id, label, count, children }) {
  return (
    <details id={`section-${id}`} className="group scroll-mt-6 py-6" open={!CLOSED.includes(id)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 [&::-webkit-details-marker]:hidden">
        <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
        {count !== undefined && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">{count}</span>}
        <Icon name="chevron" className="ml-auto size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
