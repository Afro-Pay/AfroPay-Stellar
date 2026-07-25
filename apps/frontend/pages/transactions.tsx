import React from 'react';
import Head from 'next/head';
import { withAuth } from '../lib/withAuth';
import TransactionDashboard from '../components/TransactionDashboard';

function TransactionsPage() {
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

export default withAuth(TransactionsPage);
