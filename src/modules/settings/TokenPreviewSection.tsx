import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

import { readTokenSnapshot } from '@/shared/tokenSnapshot';
import type { TokenSnapshot } from '@/shared/tokenSnapshot';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';

/**
 * The token preview (§6's optional 随附功能): every custom property the document
 * resolves, grouped by family, in both appearances.
 *
 * The snapshot is taken when the section is opened, not kept live: a debug tool
 * that re-reads the document on every theme change would have to own a render
 * path for it, and the reader opening it wants the state of the page they are
 * looking at. Opening again re-reads.
 *
 * The read flips the `.dark` class synchronously (see `readTokenSnapshot`), so
 * it must run in an event handler — never in a render — and it restores the
 * class before the task yields.
 */
export default function TokenPreviewSection() {
  const { t } = useTranslation('settings');
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null);

  const toggle = () => {
    if (snapshot) {
      setSnapshot(null);
      return;
    }
    setSnapshot(readTokenSnapshot());
  };

  return (
    <SettingsSection title={t('tokenPreview.title')} description={t('tokenPreview.description')}>
      <SettingsCard>
        <div className="p-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={snapshot !== null}
            onClick={toggle}
          >
            {t(snapshot === null ? 'tokenPreview.open' : 'tokenPreview.close')}
            <ChevronDown
              aria-hidden="true"
              className={cn('transition-transform duration-200', snapshot !== null && 'rotate-180')}
            />
          </Button>

          {snapshot !== null && (
            <div className="mt-4 space-y-6">
              {snapshot.groups.map((group) => (
                <div key={group.id}>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(group.id === 'semantic' ? 'tokenPreview.semanticGroup' : 'tokenPreview.familyGroup', {
                      family: group.id,
                    })}
                    <span className="ml-2 font-normal normal-case">{group.entries.length}</span>
                  </h4>
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {group.entries.map((entry) => (
                      <li key={entry.name} className="flex items-center gap-3 px-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                          {entry.name}
                        </span>
                        <span className="flex items-center gap-1.5" data-appearance-column="light">
                          <span
                            aria-hidden
                            data-token-swatch={entry.name}
                            data-scope="light"
                            className="h-4 w-4 shrink-0 rounded border border-border"
                            style={entry.lightSwatch ? { background: entry.lightSwatch } : undefined}
                          />
                          <span className="w-36 truncate font-mono text-xs text-muted-foreground">
                            {entry.light}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5" data-appearance-column="dark">
                          <span
                            aria-hidden
                            data-token-swatch={entry.name}
                            data-scope="dark"
                            className="h-4 w-4 shrink-0 rounded border border-border"
                            style={entry.darkSwatch ? { background: entry.darkSwatch } : undefined}
                          />
                          <span className="w-36 truncate font-mono text-xs text-muted-foreground">
                            {entry.dark}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}
