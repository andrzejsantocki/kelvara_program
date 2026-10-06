import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createPortfolioOrchestrator } from '../subapps/kamino-monitor/portfolio-orchestrator.js';
const { privateKey } = generateKeyPairSync('ed25519');
const wallet = '883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62';
const manifest = { policyRevision: 1, protocols: [{ id: 'p', name: 'p', chain: 'solana', status: 'active', discoveryAdapterId: 'kamino', discoveryAdapterVersion: 1 }], targets: [{ id: 't', protocolId: 'p', kind: 'position', name: 't', status: 'active', address: 'a' }] };
test('authenticated portfolio sends signed owner receipt to private Control Plane projection', async () => {
  let request;
  const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => ({ policyRevision: 1, protocols: [{ ...manifest.protocols[0], targetIds: ['t'] }], targets: manifest.targets, bindings: [], ruleVersions: [] }), readOwnerPrivate: async receipt => { request = receipt; return { walletId: wallet, enrollments: [] }; } }, observationHubClient: { readLatest: async () => ({ policyRevision: 1, receipts: [] }) }, ownerReceiptPrivateKey: privateKey, adapters: { 'kamino@1': { discover: async () => ({ positions: [{ targetId: 't', protocol: 'kamino', adapterId: 'kamino', adapterVersion: 1, display: 't', details: {} }] }) } } });
  await orchestrator.getPortfolio(wallet, { authenticatedWallet: wallet });
  assert.equal(request, wallet);
});
