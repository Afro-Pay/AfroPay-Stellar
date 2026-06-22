import React from 'react';
import Head from 'next/head';
import TransactionDashboard from '../components/TransactionDashboard';

export default function TransactionsPage() {
  return (
    <div className="min-h-screen bg-black">
      <Head>
        <title>Transaction History | AfroPay Stellar</title>
        <meta name="description" content="View your AfroPay remittance transaction history, including statuses, fee breakdowns, and Stellar transaction hashes." />
      </Head>

      <main>
        <TransactionDashboard />
      </main>
    </div>
  );
}
