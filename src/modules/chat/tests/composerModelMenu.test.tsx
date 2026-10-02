import assert from 'node:assert/strict';

import { fireEvent, render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';

const anchorState = vi.hoisted(() => ({ maxHeight: 400 }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/modules/chat/hooks/useComposerMenuAnchor', () => ({
  useComposerMenuAnchor: () => ({
    triggerRef: { current: null },
    menuRef: { current: null },
    anchor: {
      side: 'right',
      offset: 0,
      bottom: 0,
      maxHeight: anchorState.maxHeight,
      maxWidth: 500,
    },
    updateAnchor: () => undefined,
  }),
}));

beforeEach(() => {
  anchorState.maxHeight = 400;
});

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

test('renders an option description as its subtitle line', () => {
  const { getByLabelText, getByRole, getByText } = render(
    <ComposerModelMenu
      effort="none"
      effortOptions={[]}
      onSelectEffort={() => undefined}
      model="model-a"
      modelOptions={[
        { value: 'model-a', label: 'Model A', description: '旗舰推理模型' },
      ]}
      onSelectModel={() => undefined}
      modelsLoading={false}
    />,
  );

  fireEvent.click(getByLabelText('composer.modelMenu'));
  fireEvent.click(getByRole('menuitem', { name: 'Model A' }));

  assert.ok(getByText('旗舰推理模型'));
});

test('shows the filter input only at or above the catalog threshold', () => {
  const catalog = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      value: `model-${index}`,
      label: `Model ${index}`,
    }));

  const small = render(
    <ComposerModelMenu
      effort="none"
      effortOptions={[]}
      onSelectEffort={() => undefined}
      model="model-0"
      modelOptions={catalog(14)}
      onSelectModel={() => undefined}
      modelsLoading={false}
    />,
  );
  fireEvent.click(small.getByLabelText('composer.modelMenu'));
  fireEvent.click(small.getByRole('menuitem', { name: 'Model 0' }));
  assert.ok(small.queryByPlaceholderText('composer.modelSearchPlaceholder') === null);
  small.unmount();

  const large = render(
    <ComposerModelMenu
      effort="none"
      effortOptions={[]}
      onSelectEffort={() => undefined}
      model="model-0"
      modelOptions={catalog(15)}
      onSelectModel={() => undefined}
      modelsLoading={false}
    />,
  );
  fireEvent.click(large.getByLabelText('composer.modelMenu'));
  fireEvent.click(large.getByRole('menuitem', { name: 'Model 0' }));
  const input = large.getByPlaceholderText('composer.modelSearchPlaceholder');
  assert.ok(input);
  // Expanding the section must not steal focus: on phones an autofocused input pops the IME keyboard.
  assert.ok(document.activeElement !== input);
});

test('filtering searches labels, values and descriptions, and opens every matching section', () => {
  const modelOptions = [
    { value: 'a1', label: 'Model a1', group: 'Channel A' },
    ...Array.from({ length: 15 }, (_, index) => ({
      value: `b${index}`,
      label: `Model b${index}`,
      description: index === 2 ? '经济档倍率' : undefined,
      group: 'Channel B',
    })),
  ];
  const { getByLabelText, getByRole, getByPlaceholderText, getByText, queryByRole } = render(
    <ComposerModelMenu
      effort="none"
      effortOptions={[]}
      onSelectEffort={() => undefined}
      model="a1"
      modelOptions={modelOptions}
      onSelectModel={() => undefined}
      modelsLoading={false}
    />,
  );

  fireEvent.click(getByLabelText('composer.modelMenu'));
  fireEvent.click(getByRole('menuitem', { name: 'Channel A · Model a1' }));

  // Channel B stays collapsed before filtering: only the selected channel is open.
  assert.ok(queryByRole('menuitemradio', { name: 'Model b2' }) === null);

  const input = getByPlaceholderText('composer.modelSearchPlaceholder');
  fireEvent.change(input, { target: { value: '经济档' } });

  // The description matches even though no label or value contains the query,
  // and the collapsed Channel B section opens to show its match. The accessible
  // name includes the description line, hence the prefix regex.
  assert.ok(getByRole('menuitemradio', { name: /^Model b2/ }));
  assert.ok(queryByRole('menuitemradio', { name: 'Model a1' }) === null);

  fireEvent.change(input, { target: { value: 'zzz' } });
  assert.ok(getByText('composer.noModelsMatch'));
});

test('caps the menu height even when the viewport offers more room', () => {
  anchorState.maxHeight = 1000;
  const { getByLabelText, getByRole } = render(
    <ComposerModelMenu
      effort="none"
      effortOptions={[]}
      onSelectEffort={() => undefined}
      model="model-a"
      modelOptions={[{ value: 'model-a', label: 'Model A' }]}
      onSelectModel={() => undefined}
      modelsLoading={false}
    />,
  );

  fireEvent.click(getByLabelText('composer.modelMenu'));
  assert.equal(getByRole('menu').style.maxHeight, '480px');
});
