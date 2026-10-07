// Drives /audit in a real browser with a CIP-30 test wallet whose signing happens in Node (preprod room-150),
// so the page's own x402 code path (402 -> build -> wallet sign -> assemble -> PAYMENT-SIGNATURE) runs for real.
import { chromium } from 'playwright';
import { Address, TransactionWitnessSet } from '@evolution-sdk/evolution';
import { account, requireBlockfrost } from '@overpaid/cardano';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const bf = requireBlockfrost();
const user = account(process.env.AUDIT_TEST_WALLET ?? 'room-150');
const uc = user.signingClient(bf);
const addrHex = Address.toHex(Address.fromBech32(user.address));

// RESOLVE=host:ip pins a tunnel hostname when the local resolver has cached a failed lookup.
const browser = await chromium.launch(process.env.RESOLVE ? { args: [`--host-resolver-rules=MAP ${process.env.RESOLVE.replace(':', ' ')}`] } : {});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300)));
page.on('console', (m) => m.type() === 'error' && console.log('console error', m.text().slice(0, 300)));
await page.exposeFunction('__sign', async (cbor: string) => TransactionWitnessSet.toCBORHex(await uc.signTx(cbor, { utxos: await uc.getWalletUtxos() })));
// Plain-text init script: tsx would otherwise inject helpers the browser doesn't have.
await page.addInitScript(`(() => {
  const hex = ${JSON.stringify(addrHex)};
  const api = {
    getNetworkId: async () => 0,
    getChangeAddress: async () => hex,
    getUsedAddresses: async () => [hex],
    getBalance: async () => '1a05f5e100',
    getUtxos: async () => [],
    signTx: async (cbor) => window.__sign(cbor),
  };
  window.cardano = { testwallet: { name: 'testwallet', icon: '', apiVersion: '1', enable: async () => api, isEnabled: async () => true } };
})()`);

await page.goto(`${WEB}/audit`);
await page.getByRole('button', { name: /Connect testwallet/i }).or(page.getByText('Find the money')).first().waitFor();
await page.waitForTimeout(3000);
await page.getByText('Use a sample statement').click();
await page.getByRole('button', { name: 'Check for free' }).click();
await page.getByText('What we found').waitFor({ timeout: 60_000 });
console.log('preview:', (await page.locator('.num').first().textContent())?.trim());
const connect = page.getByRole('button', { name: /Connect testwallet/i });
if (!(await connect.isVisible().catch(() => false))) console.log('page text:', (await page.locator('main').innerText()).slice(0, 1500));
await connect.click();
await page.getByRole('button', { name: /Unlock the audit/ }).click({ timeout: 30_000 });
await page.getByText('Paid over x402 on Cardano preprod.').waitFor({ timeout: 180_000 }).catch(async (e) => {
  console.log('page text:', (await page.locator('main').innerText()).slice(-700));
  throw e;
});
const tx = await page.locator('a.op-pill.good').getAttribute('href');
console.log('paid:', tx);
console.log('report starts:', (await page.locator('h2').filter({ hasText: 'Recovery audit' }).count()) > 0);
await page.screenshot({ path: process.env.SHOT ?? '/tmp/audit-ui.png', fullPage: true });
await browser.close();
