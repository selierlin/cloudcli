import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { test, vi } from 'vitest';

import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/modules/chat/hooks/useComposerMenuAnchor', () => ({
  useComposerMenuAnchor: () => ({
    triggerRef: { current: null },
    menuRef: { current: null },
    anchor: { side: 'right', offset: 0, bottom: 0, maxHeight: 400, maxWidth: 500 },
    updateAnchor: () => undefined,
  }),
}));

test('shows the model catalog notice alongside its model options', () => {
  const notice = '高级点数 / 百万 Tokens；括号为普通输入→输出';
  const { getByLabelText, getByRole, getByText } = render(
    <ComposerModelMenu
      effort="none"
      effortOptions={[]}
      onSelectEffort={() => undefined}
      model="model-a"
      modelOptions={[{ value: 'model-a', label: 'Model A（75→375）' }]}
      modelNotice={notice}
      onSelectModel={() => undefined}
      modelsLoading={false}
    />,
  );

  fireEvent.click(getByLabelText('composer.modelMenu'));
  fireEvent.click(getByRole('menuitem', { name: 'Model A（75→375）' }));

  assert.ok(getByText(notice));
  assert.ok(getByRole('menuitemradio', { name: 'Model A（75→375）' }));
});
