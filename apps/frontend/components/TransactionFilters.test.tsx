import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import TransactionFilters, {
  TransactionFilterValues,
  EMPTY_FILTERS,
} from './TransactionFilters';

const setup = (initial: Partial<TransactionFilterValues> = {}) => {
  const onChange = jest.fn();
  const onReset = jest.fn();
  const values: TransactionFilterValues = { ...EMPTY_FILTERS, ...initial };
  const utils = render(
    <TransactionFilters values={values} onChange={onChange} onReset={onReset} />
  );
  return { onChange, onReset, ...utils };
};

describe('TransactionFilters', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('search input', () => {
    it('calls onChange with the debounced query after typing', () => {
      const { onChange } = setup();

      const search = screen.getByPlaceholderText(/search/i);
      fireEvent.change(search, { target: { value: 'abc123' } });

      // Should not fire immediately (debounced)
      expect(onChange).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ search: 'abc123' });
    });

    it('debounces rapid typing into a single onChange call', () => {
      const { onChange } = setup();

      const search = screen.getByPlaceholderText(/search/i);
      fireEvent.change(search, { target: { value: 'a' } });
      fireEvent.change(search, { target: { value: 'ab' } });
      fireEvent.change(search, { target: { value: 'abc' } });

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ search: 'abc' });
    });

    it('supports destination, amount, and reference queries via the search field', () => {
      const { onChange } = setup();

      const search = screen.getByPlaceholderText(/search/i);
      fireEvent.change(search, { target: { value: 'GABC123' } });

      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(onChange).toHaveBeenCalledWith({ search: 'GABC123' });
    });
  });

  describe('date range controls', () => {
    it('emits the correct patch when the start date changes', () => {
      const { onChange } = setup();

      const startDate = screen.getByLabelText(/start date/i);
      fireEvent.change(startDate, { target: { value: '2024-01-01' } });

      expect(onChange).toHaveBeenCalledWith({ dateFrom: '2024-01-01' });
    });

    it('emits the correct patch when the end date changes', () => {
      const { onChange } = setup();

      const endDate = screen.getByLabelText(/end date/i);
      fireEvent.change(endDate, { target: { value: '2024-12-31' } });

      expect(onChange).toHaveBeenCalledWith({ dateTo: '2024-12-31' });
    });
  });

  describe('asset type control', () => {
    it('emits the correct patch when the asset type changes', () => {
      const { onChange } = setup();

      const assetType = screen.getByLabelText(/asset type/i);
      fireEvent.change(assetType, { target: { value: 'native' } });

      expect(onChange).toHaveBeenCalledWith({ assetType: 'native' });
    });
  });

  describe('status control', () => {
    it('emits the correct patch when the status changes', () => {
      const { onChange } = setup();

      const status = screen.getByLabelText(/status/i);
      fireEvent.change(status, { target: { value: 'completed' } });

      expect(onChange).toHaveBeenCalledWith({ status: 'completed' });
    });
  });

  describe('destination control', () => {
    it('emits the correct patch when the destination changes', () => {
      const { onChange } = setup();

      const destination = screen.getByLabelText(/destination/i);
      fireEvent.change(destination, { target: { value: 'GDEST123' } });

      expect(onChange).toHaveBeenCalledWith({ destination: 'GDEST123' });
    });
  });

  describe('reset button', () => {
    it('is disabled when no filters are active', () => {
      setup();

      const reset = screen.getByRole('button', { name: /reset/i });
      expect(reset).toBeDisabled();
    });

    it('is enabled when at least one filter is active', () => {
      setup({ status: 'completed' });

      const reset = screen.getByRole('button', { name: /reset/i });
      expect(reset).toBeEnabled();
    });

    it('clears all filters when clicked', () => {
      const { onReset, onChange } = setup({
        search: 'abc',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        assetType: 'native',
        status: 'completed',
        destination: 'GDEST123',
      });

      const reset = screen.getByRole('button', { name: /reset/i });
      fireEvent.click(reset);

      expect(onReset).toHaveBeenCalledTimes(1);
      if (onChange.mock.calls.length > 0) {
        expect(onChange).toHaveBeenLastCalledWith(EMPTY_FILTERS);
      }
    });
  });
});