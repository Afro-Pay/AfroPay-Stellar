import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Filter, Search, X } from 'lucide-react';

export interface TransactionFilterState {
  query: string;
  dateFrom: string;
  dateTo: string;
  asset: string;
  status: string;
  destination: string;
}

interface FiltersProps {
  filters: TransactionFilterState;
  onChange: (patch: Partial<TransactionFilterState>) => void;
  onReset: () => void;
  availableAssets: string[];
}

const EMPTY_FILTERS: TransactionFilterState = {
  query: '',
  dateFrom: '',
  dateTo: '',
  asset: 'all',
  status: 'all',
  destination: '',
};

const DEBOUNCE_MS = 300;

const inputClasses =
  'w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-indigo-500';

export default function TransactionFilters({
  filters,
  onChange,
  onReset,
  availableAssets,
}: FiltersProps) {
  const [queryInput, setQueryInput] = useState(filters.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Keep local input in sync when the query is changed externally (e.g. reset).
  useEffect(() => {
    setQueryInput(filters.query);
  }, [filters.query]);

  // Debounce query updates so results refresh without a page reload.
  useEffect(() => {
    if (queryInput === filters.query) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChangeRef.current({ query: queryInput });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [queryInput, filters.query]);

  const hasActiveFilters = (Object.keys(EMPTY_FILTERS) as (keyof TransactionFilterState)[]).some(
    (key) => filters[key] !== EMPTY_FILTERS[key],
  );

  return (
    <fieldset
      role="search"
      aria-label="Filter transactions"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6"
    >
      <legend className="sr-only">Filter transactions</legend>

      <div className="relative sm:col-span-2 lg:col-span-3">
        <label htmlFor="transaction-search" className="sr-only">
          Search by destination, amount, or reference
        </label>
        <input
          id="transaction-search"
          name="query"
          type="search"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Search destination, amount, or reference"
          aria-label="Search by destination, amount, or reference"
          className={`${inputClasses} pl-10`}
        />
        <Search
          aria-hidden="true"
          className="absolute left-3 top-3.5 text-gray-500 w-4 h-4 pointer-events-none"
        />
      </div>

      <div className="relative">
        <label htmlFor="transaction-date-from" className="sr-only">
          Date from
        </label>
        <input
          id="transaction-date-from"
          name="dateFrom"
          type="date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ dateFrom: e.target.value })}
          aria-label="Date from"
          className={inputClasses}
        />
        <Calendar
          aria-hidden="true"
          className="absolute right-3 top-3.5 text-gray-500 w-4 h-4 pointer-events-none"
        />
      </div>

      <div className="relative">
        <label htmlFor="transaction-date-to" className="sr-only">
          Date to
        </label>
        <input
          id="transaction-date-to"
          name="dateTo"
          type="date"
          value={filters.dateTo}
          onChange={(e) => onChange({ dateTo: e.target.value })}
          aria-label="Date to"
          className={inputClasses}
        />
        <Calendar
          aria-hidden="true"
          className="absolute right-3 top-3.5 text-gray-500 w-4 h-4 pointer-events-none"
        />
      </div>

      <div className="relative">
        <label htmlFor="transaction-asset" className="sr-only">
          Asset type
        </label>
        <select
          id="transaction-asset"
          name="asset"
          value={filters.asset}
          onChange={(e) => onChange({ asset: e.target.value })}
          aria-label="Asset type"
          className={`${inputClasses} appearance-none`}
        >
          <option value="all">All Assets</option>
          {availableAssets.map((asset) => (
            <option key={asset} value={asset}>
              {asset}
            </option>
          ))}
        </select>
        <Filter
          aria-hidden="true"
          className="absolute right-3 top-3.5 text-gray-500 w-4 h-4 pointer-events-none"
        />
      </div>

      <div className="relative">
        <label htmlFor="transaction-status" className="sr-only">
          Status
        </label>
        <select
          id="transaction-status"
          name="status"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value })}
          aria-label="Status"
          className={`${inputClasses} appearance-none`}
        >
          <option value="all">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="SUCCESS">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="RETRYING">Retrying</option>
        </select>
        <Filter
          aria-hidden="true"
          className="absolute right-3 top-3.5 text-gray-500 w-4 h-4 pointer-events-none"
        />
      </div>

      <div className="relative">
        <label htmlFor="transaction-destination" className="sr-only">
          Destination address
        </label>
        <input
          id="transaction-destination"
          name="destination"
          type="text"
          value={filters.destination}
          onChange={(e) => onChange({ destination: e.target.value })}
          placeholder="Destination address"
          aria-label="Destination address"
          className={inputClasses}
        />
      </div>

      <div className="flex items-center sm:col-span-2 lg:col-span-3">
        <button
          type="button"
          onClick={onReset}
          disabled={!hasActiveFilters}
          aria-label="Clear all filters"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-300 hover:border-indigo-500 focus:outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X aria-hidden="true" className="w-4 h-4" />
          Clear filters
        </button>
      </div>
    </fieldset>
  );
}
