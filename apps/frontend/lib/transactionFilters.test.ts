import { describe, it, expect } from 'vitest';
import {
  filterTransactions,
  hasActiveFilters,
  type TransactionFilterCriteria,
  type FilterableTransaction,
} from './transactionFilters';

const makeTx = (
  overrides: Partial<FilterableTransaction> = {},
): FilterableTransaction => ({
  id: 'tx-1',
  createdAt: '2024-06-15T12:00:00.000Z',
  asset: 'XLM',
  status: 'completed',
  destination: 'GABCDEF1234567890',
  amount: '100.5',
  stellarTxHash: 'abc123hash',
  ...overrides,
});

const emptyCriteria: TransactionFilterCriteria = {
  dateFrom: null,
  dateTo: null,
  asset: null,
  status: null,
  destination: '',
  query: '',
};

describe('filterTransactions', () => {
  describe('date range boundaries', () => {
    const txs = [
      makeTx({ id: 'before', createdAt: '2024-06-01T00:00:00.000Z' }),
      makeTx({ id: 'start', createdAt: '2024-06-10T00:00:00.000Z' }),
      makeTx({ id: 'middle', createdAt: '2024-06-15T12:00:00.000Z' }),
      makeTx({ id: 'end', createdAt: '2024-06-20T00:00:00.000Z' }),
      makeTx({ id: 'after', createdAt: '2024-06-25T00:00:00.000Z' }),
    ];

    it('includes transactions on the from boundary', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        dateFrom: '2024-06-10',
      });
      expect(result.map((t) => t.id)).toEqual(['start', 'middle', 'end', 'after']);
    });

    it('includes transactions on the to boundary', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        dateTo: '2024-06-20',
      });
      expect(result.map((t) => t.id)).toEqual(['before', 'start', 'middle', 'end']);
    });

    it('filters within an inclusive range', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        dateFrom: '2024-06-10',
        dateTo: '2024-06-20',
      });
      expect(result.map((t) => t.id)).toEqual(['start', 'middle', 'end']);
    });

    it('returns all when no date bounds are set', () => {
      const result = filterTransactions(txs, emptyCriteria);
      expect(result).toHaveLength(txs.length);
    });
  });

  describe('asset and status matching', () => {
    const txs = [
      makeTx({ id: 'xlm-completed', asset: 'XLM', status: 'completed' }),
      makeTx({ id: 'usdc-completed', asset: 'USDC', status: 'completed' }),
      makeTx({ id: 'xlm-pending', asset: 'XLM', status: 'pending' }),
      makeTx({ id: 'usdc-failed', asset: 'USDC', status: 'failed' }),
    ];

    it('filters by asset', () => {
      const result = filterTransactions(txs, { ...emptyCriteria, asset: 'XLM' });
      expect(result.map((t) => t.id)).toEqual(['xlm-completed', 'xlm-pending']);
    });

    it('filters by status', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        status: 'completed',
      });
      expect(result.map((t) => t.id)).toEqual(['xlm-completed', 'usdc-completed']);
    });

    it('combines asset and status filters', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        asset: 'USDC',
        status: 'failed',
      });
      expect(result.map((t) => t.id)).toEqual(['usdc-failed']);
    });

    it('ignores asset and status when null', () => {
      const result = filterTransactions(txs, emptyCriteria);
      expect(result).toHaveLength(txs.length);
    });
  });

  describe('destination substring match', () => {
    const txs = [
      makeTx({ id: 'a', destination: 'GABCDEF1234567890' }),
      makeTx({ id: 'b', destination: 'GXYZ9876543210' }),
      makeTx({ id: 'c', destination: 'GABCXYZ000000' }),
    ];

    it('matches destination substrings', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        destination: 'ABC',
      });
      expect(result.map((t) => t.id)).toEqual(['a', 'c']);
    });

    it('is case-insensitive', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        destination: 'xyz',
      });
      expect(result.map((t) => t.id)).toEqual(['b', 'c']);
    });

    it('returns all when destination is empty', () => {
      const result = filterTransactions(txs, emptyCriteria);
      expect(result).toHaveLength(txs.length);
    });
  });

  describe('query matching', () => {
    const txs = [
      makeTx({
        id: 'by-destination',
        destination: 'GDESTINATION123',
        amount: '10',
        stellarTxHash: 'hashaaa',
      }),
      makeTx({
        id: 'by-amount',
        destination: 'GOTHER000',
        amount: '250.75',
        stellarTxHash: 'hashbbb',
      }),
      makeTx({
        id: 'by-hash',
        destination: 'GTHIRD000',
        amount: '5',
        stellarTxHash: 'deadbeefcafe',
      }),
    ];

    it('matches against destination', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        query: 'DESTINATION',
      });
      expect(result.map((t) => t.id)).toEqual(['by-destination']);
    });

    it('matches against amount', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        query: '250.75',
      });
      expect(result.map((t) => t.id)).toEqual(['by-amount']);
    });

    it('matches against stellarTxHash', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        query: 'deadbeef',
      });
      expect(result.map((t) => t.id)).toEqual(['by-hash']);
    });

    it('is case-insensitive', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        query: 'hashbbb',
      });
      expect(result.map((t) => t.id)).toEqual(['by-amount']);
    });

    it('returns all when query is empty', () => {
      const result = filterTransactions(txs, emptyCriteria);
      expect(result).toHaveLength(txs.length);
    });

    it('returns empty when nothing matches', () => {
      const result = filterTransactions(txs, {
        ...emptyCriteria,
        query: 'nomatch-zzz',
      });
      expect(result).toHaveLength(0);
    });
  });

  it('combines all criteria', () => {
    const txs = [
      makeTx({
        id: 'match',
        createdAt: '2024-06-15T12:00:00.000Z',
        asset: 'USDC',
        status: 'completed',
        destination: 'GABC123',
        amount: '42',
        stellarTxHash: 'hashmatch',
      }),
      makeTx({
        id: 'wrong-asset',
        createdAt: '2024-06-15T12:00:00.000Z',
        asset: 'XLM',
        status: 'completed',
        destination: 'GABC123',
        amount: '42',
        stellarTxHash: 'hashmatch',
      }),
    ];

    const result = filterTransactions(txs, {
      dateFrom: '2024-06-01',
      dateTo: '2024-06-30',
      asset: 'USDC',
      status: 'completed',
      destination: 'GABC',
      query: 'hashmatch',
    });

    expect(result.map((t) => t.id)).toEqual(['match']);
  });
});

describe('hasActiveFilters', () => {
  it('returns false for empty criteria', () => {
    expect(hasActiveFilters(emptyCriteria)).toBe(false);
  });

  it('returns true when dateFrom is set', () => {
    expect(hasActiveFilters({ ...emptyCriteria, dateFrom: '2024-06-01' })).toBe(true);
  });

  it('returns true when dateTo is set', () => {
    expect(hasActiveFilters({ ...emptyCriteria, dateTo: '2024-06-30' })).toBe(true);
  });

  it('returns true when asset is set', () => {
    expect(hasActiveFilters({ ...emptyCriteria, asset: 'XLM' })).toBe(true);
  });

  it('returns true when status is set', () => {
    expect(hasActiveFilters({ ...emptyCriteria, status: 'pending' })).toBe(true);
  });

  it('returns true when destination is non-empty', () => {
    expect(hasActiveFilters({ ...emptyCriteria, destination: 'GABC' })).toBe(true);
  });

  it('returns true when query is non-empty', () => {
    expect(hasActiveFilters({ ...emptyCriteria, query: 'abc' })).toBe(true);
  });

  it('returns false when destination and query are whitespace only', () => {
    expect(
      hasActiveFilters({ ...emptyCriteria, destination: '   ', query: '  ' }),
    ).toBe(false);
  });
});