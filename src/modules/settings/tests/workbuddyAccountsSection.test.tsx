import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type {
  WorkbuddySwitchAccount,
  WorkbuddySwitchCredits,
  WorkbuddySwitchStatus,
} from '@/shared/types';

/**
 * The card's job is deciding what it can offer: an install hint when the
 * companion is absent, a switch button per usable account, and a restart
 * warning when CloudCLI itself has a workbuddy turn running. Copy is asserted
 * through translation keys rather than translated text, so the assertions do
 * not depend on the active locale.
 */

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const state: {
  status: WorkbuddySwitchStatus;
  credits: WorkbuddySwitchCredits;
  runningProviders: string[];
  switchCalls: string[];
  /** How many times the card read the companion state. */
  statusReads: number;
  /** Answer for every read after the first, so a test can tell the recovery read's state actually landed. */
  statusFromSecondRead: WorkbuddySwitchStatus | null;
  switchAnswer: () => Response | Promise<Response>;
} = {
  status: { available: false, version: null, running: false, currentUid: null, accounts: [] },
  credits: { available: true, credits: [] },
  runningProviders: [],
  switchCalls: [],
  statusReads: 0,
  statusFromSecondRead: null,
  switchAnswer: () => json({ success: true, data: { account: null, restarted: false, status: state.status } }),
};

vi.mock('@/shared/api', async (importOriginal) => {
  // The real readApiJson, so a refused switch surfaces the same message the app
  // shows in production instead of a mock that swallows the error envelope.
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: {
      workbuddySwitch: {
        status: async () => {
          state.statusReads += 1;
          const answer = state.statusReads > 1 && state.statusFromSecondRead
            ? state.statusFromSecondRead
            : state.status;
          return json({ success: true, data: answer });
        },
        switchAccount: async (accountId: string) => {
          state.switchCalls.push(accountId);
          return state.switchAnswer();
        },
        progress: async () => json({ success: true, data: { running: false, progress: null } }),
        credits: async () => json({ success: true, data: state.credits }),
      },
      runningSessions: async () => json({
        success: true,
        data: { sessions: state.runningProviders.map((provider) => ({ provider, sessionId: 's' })) },
      }),
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
    i18n: { language: 'en' },
  }),
}));

const account = (overrides: Partial<WorkbuddySwitchAccount> & { id: string }): WorkbuddySwitchAccount => ({
  uid: `uid-${overrides.id}`,
  nickname: null,
  phoneNumber: null,
  email: null,
  expiresAt: null,
  needsRelogin: false,
  isEnterprise: false,
  ...overrides,
});

const CONNECTED: WorkbuddySwitchStatus = {
  available: true,
  version: '0.1.62',
  running: false,
  currentUid: 'uid-a',
  accounts: [
    account({ id: 'a', nickname: 'Selier', phoneNumber: '153****6231', expiresAt: 1_795_588_832_767 }),
    account({ id: 'b', nickname: '七娃', phoneNumber: '177****1452' }),
  ],
};

/** Renders the card with the current state mocked above. */
async function renderCard(): Promise<void> {
  const { default: WorkbuddyAccountsSection } = await import(
    '@/modules/settings/tabs/agents-settings/sections/content/WorkbuddyAccountsSection'
  );
  render(<WorkbuddyAccountsSection />);
}

beforeEach(() => {
  state.status = { available: false, version: null, running: false, currentUid: null, accounts: [] };
  state.credits = { available: true, credits: [] };
  state.runningProviders = [];
  state.switchCalls = [];
  state.statusReads = 0;
  state.statusFromSecondRead = null;
});

describe('WorkbuddyAccountsSection', () => {
  it('shows the start commands when the companion is absent', async () => {
    await renderCard();

    expect(await screen.findByText('npm i -g workbuddy-switch')).toBeTruthy();
    expect(screen.getByText('wb-switch serve')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lists the usable accounts and marks the signed-in one', async () => {
    state.status = CONNECTED;
    await renderCard();

    expect(await screen.findByText('七娃')).toBeTruthy();
    expect(screen.getByText('agents.workbuddyAccounts.current')).toBeTruthy();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect(buttons[0].textContent).toBe('agents.workbuddyAccounts.inUse');
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('switches to the clicked account', async () => {
    state.status = CONNECTED;
    await renderCard();

    const switchButton = (await screen.findAllByRole('button'))[1];
    fireEvent.click(switchButton);

    await waitFor(() => expect(state.switchCalls).toEqual(['b']));
  });

  it('never offers an account whose stored session needs a new sign-in', async () => {
    state.status = {
      ...CONNECTED,
      accounts: [account({ id: 'c', nickname: '1007', needsRelogin: true })],
    };
    await renderCard();

    const button = (await screen.findAllByRole('button'))[0] as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('warns that a switch interrupts a running workbuddy session', async () => {
    state.status = { ...CONNECTED, running: true };
    state.runningProviders = ['workbuddy'];
    await renderCard();

    expect(await screen.findByText('agents.workbuddyAccounts.restartWithSessions')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons[1].textContent).toBe('agents.workbuddyAccounts.switchAndRestart');
  });

  it('shows the credits each account has left', async () => {
    state.status = CONNECTED;
    state.credits = {
      available: true,
      credits: [
        { accountId: 'a', remaining: 2759.93, total: 5317, error: null },
        { accountId: 'b', remaining: 12, total: 100, error: null },
      ],
    };
    await renderCard();

    // Rounded down, so the row never claims more than can still be spent.
    expect(await screen.findByText(/creditsRemaining.*2,759/)).toBeTruthy();
    expect(screen.getByText(/creditsRemaining.*12/)).toBeTruthy();
  });

  it('keeps a row switchable when only its balance is missing', async () => {
    state.status = CONNECTED;
    state.credits = {
      available: true,
      credits: [
        {
          accountId: 'b',
          remaining: null,
          total: null,
          error: 'The stored session needs a new sign-in.',
        },
      ],
    };
    await renderCard();

    expect(await screen.findByText(/creditsUnavailable/)).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports a refused switch without losing the account list', async () => {
    state.status = { ...CONNECTED, running: true, currentUid: 'uid-a' };
    // The refusal makes the card re-read the real state. Giving that read its own
    // version makes its landing observable, which is what pins the message: the
    // read used to clear it in the same update that renders this version.
    state.statusFromSecondRead = { ...state.status, version: '0.9.9' };
    state.switchAnswer = () => json({
      success: false,
      error: { code: 'WORKBUDDY_SWITCH_BUSY', message: '已有切换任务进行中' },
    });
    await renderCard();

    fireEvent.click((await screen.findAllByRole('button'))[1]);

    expect(await screen.findByText(/已有切换任务进行中/)).toBeTruthy();
    expect(screen.getByText('七娃')).toBeTruthy();

    expect(await screen.findByText('workbuddy-switch v0.9.9')).toBeTruthy();
    expect(screen.getByText(/已有切换任务进行中/)).toBeTruthy();
  });
});
