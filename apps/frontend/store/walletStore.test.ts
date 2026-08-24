import test from 'node:test';
import assert from 'node:assert/strict';
import { useWalletStore } from './walletStore';
import api from '../lib/api';

const mockedApi = api as any;

function resetStore() {
  useWalletStore.setState({
    publicKey: null,
    balancesError: null,
    transactionsError: null,
    sendError: null,
    isLoadingBalances: false,
    isLoadingSend: false,
  });
}

test('tracks balances and transactions errors independently', () => {
  resetStore();

  useWalletStore.getState().setBalancesError('Balances failed');
  useWalletStore.getState().setTransactionsError('Transactions failed');

  assert.equal(useWalletStore.getState().balancesError, 'Balances failed');
  assert.equal(useWalletStore.getState().transactionsError, 'Transactions failed');
  assert.equal(useWalletStore.getState().sendError, null);

  useWalletStore.getState().clearError('balances');

  assert.equal(useWalletStore.getState().balancesError, null);
  assert.equal(useWalletStore.getState().transactionsError, 'Transactions failed');
});

test('sets send loading and error states on failed transfer, then clears on retry success', async () => {
  resetStore();

  mockedApi.post = async () => {
    throw new Error('boom');
  };

  await useWalletStore.getState().sendTransfer({
    destinationPublicKey: 'GABC',
    amount: '10',
    assetCode: 'XLM',
  }).catch(() => undefined);

  assert.equal(useWalletStore.getState().isLoadingSend, false);
  assert.equal(useWalletStore.getState().sendError, 'Transfer failed. Please try again.');

  mockedApi.post = async () => ({ data: { txId: 'txn-123' } });
  await useWalletStore.getState().sendTransfer({
    destinationPublicKey: 'GABC',
    amount: '10',
    assetCode: 'XLM',
  });

  assert.equal(useWalletStore.getState().sendError, null);
  assert.equal(useWalletStore.getState().isLoadingSend, false);
});
