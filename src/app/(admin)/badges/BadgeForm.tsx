'use client';

import { useState } from 'react';
import SubmitButton from '@/components/SubmitButton';
import { input, label } from '@/components/ui';
import type { Badge } from '@/lib/types';

export interface XpTier {
  value: number;
  title: string;
}

/**
 * Client component so the XP field can flag a clash as it's typed. The server
 * still rejects duplicates (assertXpTierFree in actions.ts) - this only saves
 * the admin from losing a filled-in form and a chosen icon to that redirect.
 *
 * `takenTiers` must already exclude the badge being edited.
 */
export default function BadgeForm({
  action,
  existing,
  submitLabel,
  takenTiers,
}: {
  action: (formData: FormData) => Promise<void>;
  existing?: Badge;
  submitLabel: string;
  takenTiers: XpTier[];
}) {
  const [xp, setXp] = useState(existing ? String(existing.requirement_value) : '');
  const parsed = parseInt(xp, 10);
  const clash = Number.isFinite(parsed) ? takenTiers.find(t => t.value === parsed) : undefined;

  return (
    <form action={action} className="grid max-w-xl gap-4">
      {existing && <input type="hidden" name="id" value={existing.id} />}
      <div>
        <label className={label}>Title</label>
        <input name="title" required defaultValue={existing?.title ?? ''} className={input} placeholder="e.g. Word Master" />
      </div>
      <div>
        <label className={label}>Description</label>
        <input name="description" defaultValue={existing?.description ?? ''} className={input} placeholder="e.g. Earn 150 total XP." />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>XP required to unlock</label>
          <input
            name="requirementValue"
            type="number"
            min={1}
            required
            value={xp}
            onChange={e => setXp(e.target.value)}
            aria-invalid={clash ? true : undefined}
            className={`${input} ${clash ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`}
            placeholder="e.g. 150"
          />
          {clash ? (
            <p className="mt-1 text-xs font-medium text-red-700">
              &quot;{clash.title}&quot; already unlocks at {parsed} XP. Pick a different value.
            </p>
          ) : (
            takenTiers.length > 0 && (
              <p className="mt-1 text-xs text-neutral-400">
                Already taken: {takenTiers.map(t => t.value).join(', ')}
              </p>
            )
          )}
        </div>
        <div>
          <label className={label}>Card background color</label>
          <input name="bgColor" defaultValue={existing?.bg_color ?? '#FFEBEE'} className={input} placeholder="#FFEBEE" />
        </div>
      </div>
      <div>
        <label className={label}>Badge icon image {existing?.icon_url ? '(replaces current)' : ''}</label>
        <input type="file" name="iconFile" accept="image/*" className={input} />
        <p className="mt-1 text-xs text-neutral-400">
          The app only shows uploaded icons - a badge without one displays no image.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" name="isActive" defaultChecked={existing ? existing.is_active : true} className="accent-red-700" />
        Active (inactive badges are never newly awarded, but earned ones stay in user history)
      </label>
      <SubmitButton className="w-fit" pendingLabel="Saving..." disabled={!!clash}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
