export type TransactionFilterState = {
  dateFrom: string;
  dateTo: string;
  asset: string;
  status: string;
  destination: string;
  query: string;
};

export type FilterableTransaction = {
  createdAt: string | Date;
  assetCode?: string | null;
  status?: string | null;
  destination?: string | null;
  amount?: string | number | null;
  stellarTxHash?: string | null;
  [key: string]: unknown;
};

export const DEFAULT_FILTERS: TransactionFilterState = {
  dateFrom: '',
  dateTo: '',
  asset: 'all',
  status: 'all',
  destination: '',
  query: '',
};

function toTimestamp(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').toString().toLowerCase();
}

export function filterTransactions<T extends FilterableTransaction>(
  transactions: T[],
  filters: TransactionFilterState,
): T[] {
  if (!Array.isArray(transactions)) {
    return [];
  }

  const fromTs = filters.dateFrom ? toTimestamp(filters.dateFrom) : null;
  const toTs = filters.dateTo ? toTimestamp(filters.dateTo) : null;
  const destinationFilter = normalize(filters.destination).trim();
  const queryFilter = normalize(filters.query).trim();

  return transactions.filter((tx) => {
    if (!tx) {
      return false;
    }

    if (fromTs !== null || toTs !== null) {
      const createdTs = toTimestamp(tx.createdAt);
      if (createdTs === null) {
        return false;
      }
      if (fromTs !== null && createdTs < fromTs) {
        return false;
      }
      if (toTs !== null && createdTs > toTs) {
        return false;
      }
    }

    if (filters.asset && filters.asset !== 'all') {
      if (tx.assetCode !== filters.asset) {
        return false;
      }
    }

    if (filters.status && filters.status !== 'all') {
      if (tx.status !== filters.status) {
        return false;
      }
    }

    if (destinationFilter) {
      if (!normalize(tx.destination).includes(destinationFilter)) {
        return false;
      }
    }

    if (queryFilter) {
      const haystacks = [
        normalize(tx.destination),
        normalize(tx.amount === null || tx.amount === undefined ? '' : String(tx.amount)),
        normalize(tx.stellarTxHash),
      ];
      if (!haystacks.some((value) => value.includes(queryFilter))) {
        return false;
      }
    }

    return true;
  });
}

export function hasActiveFilters(filters: TransactionFilterState): boolean {
  if (!filters) {
    return false;
  }
  return (
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    (Boolean(filters.asset) && filters.asset !== 'all') ||
    (Boolean(filters.status) && filters.status !== 'all') ||
    Boolean(filters.destination && filters.destination.trim()) ||
    Boolean(filters.query && filters.query.trim())
  );
}