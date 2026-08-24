import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { createElement } from 'react';
import SendForm from './SendForm';
import { useWalletStore } from '../store/walletStore';
import type { SimulationResult } from '../lib/api';

afterEach(() => cleanup());

async function expectNoSeriousAxeViolations(container: HTMLElement) {
  const { violations } = await axe.run(container, {
    rules: {
      // jsdom has no layout/canvas implementation for color computation.
      'color-contrast': { enabled: false },
    },
  });
  const seriousViolations = violations.filter(({ impact }) =>
    impact === 'critical' || impact === 'serious',
  );

  expect(seriousViolations).toEqual([]);
}

const OK_SIMULATION: SimulationResult = {
  status: 'ok',
  path: ['XLM'],
  sourceAmount: '10',
  estimatedDestinationAmount: '10',
  minimumDestinationAmount: '9.95',
  effectiveRate: 1,
  rateExpiresAt: null,
  issues: [],
};

const DESTINATION_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXYZ';
const DESTINATION_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQRST';

function renderSendForm() {
  const queryClient = new QueryClient();
  return render(
    createElement(QueryClientProvider, { client: queryClient }, createElement(SendForm)),
  );
}

async function fillAndPreview(destination: string, amount = '10') {
  fireEvent.change(screen.getByLabelText('Destination public key'), {
    target: { value: destination },
  });
  fireEvent.change(screen.getByLabelText('Amount'), { target: { value: amount } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview Transfer' }));
  return screen.findByRole('button', { name: 'Confirm Send' });
}

describe('SendForm destination confirmation', () => {
  let simulateTransfer: ReturnType<typeof vi.fn>;
  let sendTransfer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    simulateTransfer = vi.fn().mockResolvedValue(OK_SIMULATION);
    sendTransfer = vi.fn().mockResolvedValue({ txId: 'tx-1' });
    useWalletStore.setState({
      simulateTransfer,
      sendTransfer,
      sendError: null,
      isLoadingSend: false,
      clearError: () => {},
    });
  });

  test('disables Confirm Send until the last 4 destination characters are retyped', async () => {
    renderSendForm();
    const confirmButton = (await fillAndPreview(DESTINATION_A)) as HTMLButtonElement;

    expect(confirmButton.disabled).toBe(true);
    expect(screen.getByText(/enable sending/i)).toBeTruthy();

    const confirmInput = screen.getByLabelText(/Confirm destination/i) as HTMLInputElement;

    fireEvent.change(confirmInput, { target: { value: 'ABCD' } });
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(confirmInput, { target: { value: 'wxyz' } });
    expect(confirmButton.disabled).toBe(false);

    fireEvent.click(confirmButton);
    await waitFor(() => expect(sendTransfer).toHaveBeenCalledTimes(1));
  });

  test('re-arms the confirmation gate when the destination address changes', async () => {
    renderSendForm();
    const confirmButton = (await fillAndPreview(DESTINATION_A)) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Confirm destination/i), {
      target: { value: 'WXYZ' },
    });
    expect(confirmButton.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    const secondConfirmButton = (await fillAndPreview(DESTINATION_B)) as HTMLButtonElement;
    const secondConfirmInput = screen.getByLabelText(/Confirm destination/i) as HTMLInputElement;

    expect(secondConfirmButton.disabled).toBe(true);
    expect(secondConfirmInput.value).toBe('');

    fireEvent.change(secondConfirmInput, { target: { value: 'wxyz' } });
    // The stale (previous) suffix must no longer satisfy the new address.
    expect(secondConfirmButton.disabled).toBe(true);

    fireEvent.change(secondConfirmInput, { target: { value: 'QRST' } });
    expect(secondConfirmButton.disabled).toBe(false);
  });

  test('review step has no serious axe violations', async () => {
    const { container } = renderSendForm();
    await fillAndPreview(DESTINATION_A);
    await expectNoSeriousAxeViolations(container);
  });
});
