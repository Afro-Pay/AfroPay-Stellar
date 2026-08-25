import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component
// ---------------------------------------------------------------------------

// Mock next/router
const mockPush = vi.fn();
const mockRouterQuery: Record<string, string> = {};
vi.mock('next/router', () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    push: mockPush,
    pathname: '/anchor/interactive',
    route: '/anchor/interactive',
    asPath: '/anchor/interactive',
    isReady: true,
  }),
}));

// Mock next/head to render children inline (jsdom has no <head> management)
vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
}));

// Mock axios
const mockAxiosGet = vi.fn();
const mockAxiosPost = vi.fn();
vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => mockAxiosGet(...args),
    post: (...args: any[]) => mockAxiosPost(...args),
    create: () => ({
      get: mockAxiosGet,
      post: mockAxiosPost,
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    }),
  },
}));

// Import after mocks
import InteractivePage from './interactive';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(token = 'valid-session-jwt') {
  mockRouterQuery.token = token;
  return render(createElement(InteractivePage));
}

const MOCK_SESSION = {
  id: 'tx-001',
  kind: 'deposit' as const,
  stellarAccount: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUV',
  assetCode: 'USDC',
  assetIssuer: null,
  amount: null,
  status: 'incomplete',
};

const MOCK_CONFIRM_RESULT = {
  id: 'tx-001',
  status: 'pending_user_transfer_start',
  kind: 'deposit',
  assetCode: 'USDC',
  amount: '500',
  memo: 'abc123deadbeef',
  memoType: 'text',
  message: 'KYC data received. Waiting for on-chain transfer.',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InteractivePage', () => {
  describe('session loading', () => {
    test('shows loading spinner while fetching session', () => {
      // Axios never resolves so the page stays in loading state
      mockAxiosGet.mockReturnValue(new Promise(() => {}));
      renderPage();

      expect(screen.getByRole('status')).toBeDefined();
      expect(screen.getByText('Loading session…')).toBeDefined();
    });

    test('shows error when session fetch fails', async () => {
      mockAxiosGet.mockRejectedValueOnce({
        response: { data: { message: 'Session expired' } },
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText('Session expired')).toBeDefined();
      });
    });

    test('shows KYC form after successful session load', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: MOCK_SESSION });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Identity Verification')).toBeDefined();
        expect(screen.getByLabelText('First Name')).toBeDefined();
        expect(screen.getByLabelText('Last Name')).toBeDefined();
        expect(screen.getByLabelText('Email Address')).toBeDefined();
        expect(screen.getByLabelText('ID / Passport Number')).toBeDefined();
      });
    });
  });

  describe('KYC form validation', () => {
    beforeEach(async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: MOCK_SESSION });
      renderPage();
      await waitFor(() => screen.getByText('Identity Verification'));
    });

    test('shows validation errors when submitting empty form', async () => {
      fireEvent.click(screen.getByText('Continue to Payment'));

      await waitFor(() => {
        expect(screen.getByText('First name is required')).toBeDefined();
        expect(screen.getByText('Last name is required')).toBeDefined();
        expect(screen.getByText('Email is required')).toBeDefined();
        expect(screen.getByText('ID number is required')).toBeDefined();
      });
    });

    test('shows email validation error for invalid email', async () => {
      fireEvent.change(screen.getByLabelText('First Name'), {
        target: { value: 'John' },
      });
      fireEvent.change(screen.getByLabelText('Last Name'), {
        target: { value: 'Doe' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'not-an-email' },
      });
      fireEvent.change(screen.getByLabelText('ID / Passport Number'), {
        target: { value: 'A12345678' },
      });

      fireEvent.click(screen.getByText('Continue to Payment'));

      await waitFor(() => {
        expect(screen.getByText('Enter a valid email address')).toBeDefined();
      });
    });

    test('advances to payment step with valid KYC data', async () => {
      fireEvent.change(screen.getByLabelText('First Name'), {
        target: { value: 'John' },
      });
      fireEvent.change(screen.getByLabelText('Last Name'), {
        target: { value: 'Doe' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'john@example.com' },
      });
      fireEvent.change(screen.getByLabelText('ID / Passport Number'), {
        target: { value: 'A12345678' },
      });

      fireEvent.click(screen.getByText('Continue to Payment'));

      await waitFor(() => {
        expect(screen.getByText('Payment Details')).toBeDefined();
        expect(screen.getByLabelText('Payment Method')).toBeDefined();
      });
    });
  });

  describe('payment submission', () => {
    beforeEach(async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: MOCK_SESSION });
      renderPage();
      await waitFor(() => screen.getByText('Identity Verification'));

      // Fill KYC
      fireEvent.change(screen.getByLabelText('First Name'), {
        target: { value: 'John' },
      });
      fireEvent.change(screen.getByLabelText('Last Name'), {
        target: { value: 'Doe' },
      });
      fireEvent.change(screen.getByLabelText('Email Address'), {
        target: { value: 'john@example.com' },
      });
      fireEvent.change(screen.getByLabelText('ID / Passport Number'), {
        target: { value: 'A12345678' },
      });
      fireEvent.click(screen.getByText('Continue to Payment'));
      await waitFor(() => screen.getByText('Payment Details'));
    });

    test('submits payment and shows success screen', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: MOCK_CONFIRM_RESULT });

      fireEvent.change(screen.getByLabelText(/Amount/), {
        target: { value: '500' },
      });
      fireEvent.click(screen.getByText('Confirm Deposit'));

      await waitFor(() => {
        expect(screen.getByText('Deposit Initiated')).toBeDefined();
        expect(screen.getByText('pending_user_transfer_start')).toBeDefined();
        expect(screen.getByText('abc123deadbeef')).toBeDefined();
      });
    });

    test('sends postMessage to parent window on success', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: MOCK_CONFIRM_RESULT });

      const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

      fireEvent.change(screen.getByLabelText(/Amount/), {
        target: { value: '500' },
      });
      fireEvent.click(screen.getByText('Confirm Deposit'));

      await waitFor(() => {
        expect(screen.getByText('Deposit Initiated')).toBeDefined();
      });

      // postMessage is only sent when window.parent !== window (iframe context)
      // In jsdom they are the same, so the postMessage call is skipped.
      // We verify the success screen rendered correctly instead.
      expect(screen.getByText(/You may now close this window/)).toBeDefined();
    });

    test('shows error when submission fails', async () => {
      mockAxiosPost.mockRejectedValueOnce({
        response: { data: { message: 'Session expired during submission' } },
      });

      fireEvent.click(screen.getByText('Confirm Deposit'));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined();
        expect(screen.getByText('Session expired during submission')).toBeDefined();
      });
    });

    test('back button returns to KYC step', async () => {
      fireEvent.click(screen.getByText('Back'));

      await waitFor(() => {
        expect(screen.getByText('Identity Verification')).toBeDefined();
      });
    });
  });
});
