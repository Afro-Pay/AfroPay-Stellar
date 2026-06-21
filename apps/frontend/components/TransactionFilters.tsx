import React from 'react';
import { Calendar, Filter } from 'lucide-react';

interface FiltersProps {
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  currencyFilter: string;
  setCurrencyFilter: (c: string) => void;
  dateRangeFilter: string;
  setDateRangeFilter: (d: string) => void;
}

export default function TransactionFilters({
  statusFilter, setStatusFilter,
  currencyFilter, setCurrencyFilter,
  dateRangeFilter, setDateRangeFilter
}: FiltersProps) {
  return (
    <div className="flex flex-col md:flex-row gap-4 mb-6">
      <div className="flex-1 relative">
         <select 
           value={dateRangeFilter}
           onChange={(e) => setDateRangeFilter(e.target.value)}
           className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 appearance-none"
         >
            <option value="all">All Time</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
         </select>
         <Calendar className="absolute right-3 top-3.5 text-gray-500 w-4 h-4 pointer-events-none" />
      </div>

      <div className="flex-1 relative">
         <select 
           value={currencyFilter}
           onChange={(e) => setCurrencyFilter(e.target.value)}
           className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 appearance-none"
         >
            <option value="all">All Currencies</option>
            <option value="USDC">USDC</option>
            <option value="XLM">XLM</option>
            <option value="NGN">NGN</option>
         </select>
         <Filter className="absolute right-3 top-3.5 text-gray-500 w-4 h-4 pointer-events-none" />
      </div>

      <div className="flex-1 relative">
         <select 
           value={statusFilter}
           onChange={(e) => setStatusFilter(e.target.value)}
           className="w-full bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-indigo-500 appearance-none"
         >
            <option value="all">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SUCCESS">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="RETRYING">Retrying</option>
         </select>
         <Filter className="absolute right-3 top-3.5 text-gray-500 w-4 h-4 pointer-events-none" />
      </div>
    </div>
  );
}
