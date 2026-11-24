import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api.js';
import FieldEditor from '../FieldEditor.jsx';
import { Instructions, SectionCard, toast, useStoredState } from '../ui.jsx';
import { BadgeList } from './BadgeList.jsx';
import { ItemCards } from './ItemCards.jsx';
import { LIST_SECTIONS } from './sections.js';

// Settings > Profile details: what AI read from your resume, one part at a time. Job ranking, emails and forms use only these facts.
// Two ways of saving: text fields (contact, headline, summary) wait for "Save changes"; badges and cards save at once.
// Text edits are kept apart (`edits`), so a badge or card save never wipes something you're still typing.
// [id, label, description, tip]
const PARTS = [
  ['contact', 'Contact', 'How recruiters reach you. Used in emails, forms and your resume header.', 'Use the email you check daily. Links must be full addresses, like linkedin.com/in/you.'],
  ['about', 'About and skills', 'Your headline, summary, skills and certifications.', 'Skills drive job matching: add the tools you really use, named as job posts write them (React, Node.js, AWS). Skills and certifications save as soon as you add or remove one.'],
  ['experience', 'Experience', 'Your jobs, newest first, with what you did in each.', 'Keep dates like "Jul 2023" and "Present": your years of experience are counted from them. Changes here save straight away.'],
  ['education', 'Education', 'Degrees and where you studied.', 'Forms often ask for your highest degree and its year. Changes here save straight away.'],
  ['projects', 'Projects', 'Things you built, with the tech you used.', 'Add a link when the project is public: recruiters open them. Changes here save straight away.'],
];
const TEXT_KEYS = { contact: ['contact'], about: ['headline', 'summary'] };

export function DetailsTab({ saved, onSaved }) {
  const queryClient = useQueryClient();
  const [part, setPart] = useStoredState('profilePart', 'contact');
  const [edits, setEdits] = useState({}); // unsaved text changes, by profile key
  const [, label, description, tip] = PARTS.find(([id]) => id === part) ?? PARTS[0];
  const latest = () => queryClient.getQueryData(['profile'])?.data ?? saved;
  const put = (data) => api('/profile', { method: 'PUT', body: { data } });

  // Text fields: "Save changes" sends your edits on top of the latest saved profile.
  const saveText = useMutation({ meta: { inline: true, success: 'Profile details saved' }, mutationFn: () => put({ ...latest(), ...edits }), onSuccess: (p) => (onSaved(p), setEdits({})) });
  // Badges and cards: one list changed, saved at once. Errors show as a toast (global handler).
  const quick = useMutation({
    mutationFn: ({ key, next }) => put({ ...latest(), [key]: next }),
    onSuccess: (p, { message, undo }) => (onSaved(p), toast(message, 'success', undo && { label: 'Undo', run: undo })),
  });
  const setList = (key) => (next, message, undoable) => {
    const before = latest()[key];
    quick.mutate({ key, next, message, undo: undoable ? () => quick.mutate({ key, next: before, message: 'Undone' }) : null });
  };
  const dirty = Object.keys(edits).length > 0;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      {/* parts: a list on the left on wide screens, a scrolling row on phones */}
      <nav aria-label="Profile parts" className="flex gap-1 overflow-x-auto lg:sticky lg:top-6 lg:flex-col">
        {PARTS.map(([id, name]) => (
          <button
            key={id}
            onClick={() => setPart(id)}
            aria-current={part === id ? 'true' : undefined}
            className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
              part === id ? 'bg-cobalt-soft text-cobalt' : 'text-muted hover:bg-sunken hover:text-ink'
            }`}
          >
            {name}
            {LIST_SECTIONS[id] && <span className="rounded-full bg-surface px-1.5 text-xs font-medium text-muted tabular-nums">{saved[id]?.length ?? 0}</span>}
          </button>
        ))}
      </nav>

      <div className="min-w-0 space-y-4">
        <SectionCard title={label} description={description} instructions={<Instructions title="Tip">{tip}</Instructions>}>
          {TEXT_KEYS[part] && (
            <div className="grid gap-4 sm:grid-cols-2">
              {TEXT_KEYS[part].map((k) => (
                <FieldEditor key={k} name={k} value={edits[k] ?? saved[k]} bare onChange={(v) => setEdits({ ...edits, [k]: v })} />
              ))}
            </div>
          )}
          {part === 'about' && (
            <>
              <BadgeBlock title="Skills">
                <BadgeList items={saved.skills ?? []} noun="skill" placeholder="React, Node.js, AWS" onChange={setList('skills')} busy={quick.isPending} />
              </BadgeBlock>
              <BadgeBlock title="Certifications">
                <BadgeList items={saved.certifications ?? []} noun="certification" placeholder="AWS Cloud Practitioner" onChange={setList('certifications')} busy={quick.isPending} />
              </BadgeBlock>
            </>
          )}
          {LIST_SECTIONS[part] && <ItemCards items={saved[part] ?? []} section={LIST_SECTIONS[part]} onChange={setList(part)} busy={quick.isPending} />}
        </SectionCard>

        {/* only text fields need it; shown wherever you are while they have unsaved edits */}
        {(TEXT_KEYS[part] || dirty) && (
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-surface px-4 py-3 sm:mx-0 sm:rounded-xl sm:border sm:shadow-sm">
            <span className="mr-auto text-sm" role="status">
              {saveText.isError ? (
                <span className="text-danger">{saveText.error.issues?.[0]?.message ?? saveText.error.message}</span>
              ) : dirty ? (
                <span className="font-medium text-marigold">Unsaved changes in {Object.keys(edits).join(', ')}</span>
              ) : (
                <span className="text-muted">All changes saved</span>
              )}
            </span>
            {dirty && (
              <button className="btn-ghost" onClick={() => setEdits({})}>
                Discard
              </button>
            )}
            <button className="btn" onClick={() => saveText.mutate()} disabled={!dirty || saveText.isPending}>
              {saveText.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BadgeBlock({ title, children }) {
  return (
    <div className="border-t border-line pt-5">
      <h3 className="mb-3 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}
