import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { createElement } from 'react';
import AssetPicker from './AssetPicker';
import DepositModal from './DepositModal';
import TransactionList from './TransactionList';

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

describe('TransactionList accessibility', () => {
  test('renders transaction data with table semantics and no serious axe violations', async () => {
    const { container } = render(
      createElement(TransactionList, {
        transactions: [{
          id: 'tx-1',
          destination: 'GDESTINATION',
          amount: '25',
          assetCode: 'USDC',
          status: 'SUCCESS',
          createdAt: '2026-08-19T12:00:00.000Z',
        }],
      }),
    );

    expect(screen.getByRole('table', { name: 'Transaction history' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Destination' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy();
    await expectNoSeriousAxeViolations(container);
  });
});

describe('AssetPicker accessibility', () => {
  test('supports keyboard selection and has no serious axe violations', async () => {
    const onChange = vi.fn();
    const { container } = render(createElement(AssetPicker, {
      value: 'XLM',
      onChange,
    }));
    const picker = screen.getByRole('combobox', { name: 'Asset' });

    fireEvent.keyDown(picker, { key: 'ArrowDown' });
    expect(picker.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(picker, { key: 'ArrowDown' });
    fireEvent.keyDown(picker, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].code).not.toBe('XLM');
    expect(document.activeElement).toBe(picker);
    await expectNoSeriousAxeViolations(container);
  });
});

describe('DepositModal accessibility', () => {
  test('traps focus, closes on Escape, restores focus, and has no serious axe violations', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open deposit';
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { container } = render(createElement(DepositModal, {
      publicKey: 'GACCOUNT',
      onClose,
    }));

    const firstButton = screen.getByRole('button', { name: 'Close deposit modal' });
    const lastButton = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(firstButton);

    lastButton.focus();
    fireEvent.keyDown(lastButton, { key: 'Tab' });
    expect(document.activeElement).toBe(firstButton);

    fireEvent.keyDown(firstButton, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastButton);

    fireEvent.keyDown(lastButton, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    await expectNoSeriousAxeViolations(container);
    opener.remove();
  });
});
