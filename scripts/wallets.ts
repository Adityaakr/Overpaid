// Prints each named preprod account's ADDRESS (never keys) and, when a Blockfrost key exists, its balance.
import { account, CORE_ACCOUNTS, blockfrostConfig } from '@overpaid/cardano';

const bf = blockfrostConfig();
for (const name of CORE_ACCOUNTS) {
  const a = account(name);
  let bal = '';
  if (bf) {
    try {
      const r = await fetch(`${bf.baseUrl ?? 'https://cardano-preprod.blockfrost.io/api/v0'}/addresses/${a.address}`, {
        headers: { project_id: bf.projectId },
        signal: AbortSignal.timeout(10000),
      });
      const j = (await r.json()) as { amount?: { unit: string; quantity: string }[] };
      const l = j.amount?.find((x) => x.unit === 'lovelace')?.quantity ?? '0';
      bal = `${(Number(l) / 1e6).toFixed(2)} tADA`;
    } catch {
      bal = 'balance unavailable';
    }
  }
  console.log(`${name.padEnd(18)} ${a.address} ${bal}`);
}
if (!bf) console.log('\n(no BLOCKFROST_PROJECT_ID; addresses only)');
