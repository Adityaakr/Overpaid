/**
 * The applied vested_pay v2 script, rebuilt from the vendored MIT blueprint (contracts/NOTICE.md).
 * Params, in order: (required_admins_multi_sig: Int, admin_vks: List<VKH>, cooldown_period: Int)
 * (docs/research/vested-pay-v2.md §2). Evolution's applyParamsToScript returns double-wrapped CBOR; PlutusV3 wants
 * the single-wrapped script, so one byte-string layer is stripped.
 */
import { readFileSync } from 'node:fs';
import { Address, CBOR, Data, PlutusV3, ScriptHash, UPLC } from '@evolution-sdk/evolution';
import { masumiEscrowAddress, masumiEscrowScriptHash, type MasumiDeployment } from '@x402/cardano';
import { DEPLOYMENT, ESCROW_ADDRESS, ESCROW_SCRIPT_HASH, NETWORK } from '../constants.js';

type Blueprint = { validators: Array<{ title: string; compiledCode: string }> };

function blueprintCode(file: string, title: string): string {
  const bp = JSON.parse(readFileSync(new URL(`../../contracts/${file}`, import.meta.url), 'utf8')) as Blueprint;
  const v = bp.validators.find((x) => x.title === title);
  if (!v) throw new Error(`${file}: validator ${title} not found`);
  return v.compiledCode;
}

export function applyEscrowParams(deployment: MasumiDeployment = DEPLOYMENT): PlutusV3.PlutusV3 {
  const applied = UPLC.applyParamsToScript(blueprintCode('payment-v2.plutus.json', 'vested_pay.vested_pay.spend'), [
    Data.int(BigInt(deployment.requiredAdmins)),
    Data.list(deployment.adminVkeys.map((v) => Data.bytearray(v))),
    Data.int(BigInt(deployment.cooldownPeriod)),
  ]);
  const inner = CBOR.fromCBORHex(applied);
  if (!(inner instanceof Uint8Array)) throw new Error('unexpected applied script encoding');
  return new PlutusV3.PlutusV3({ bytes: inner });
}

export const scriptHashHex = (s: PlutusV3.PlutusV3) => ScriptHash.toHex(ScriptHash.fromScript(s)).toLowerCase();

/** Enterprise script address for a script hash on preprod (header 0x70). */
export function scriptAddress(hashHex: string): string {
  return Address.toBech32(new Address.Address({ networkId: 0, paymentCredential: ScriptHash.fromHex(hashHex) }));
}

let cached: PlutusV3.PlutusV3 | null = null;
/**
 * The canonical preprod escrow script. Throws (never returns a wrong script) unless its hash equals both the
 * research-recorded hash and x402's own derivation, and its address equals masumiEscrowAddress('cardano:preprod').
 */
export function escrowScript(): PlutusV3.PlutusV3 {
  if (cached) return cached;
  const s = applyEscrowParams();
  const h = scriptHashHex(s);
  const x402Hash = masumiEscrowScriptHash(DEPLOYMENT).toLowerCase();
  if (h !== ESCROW_SCRIPT_HASH || h !== x402Hash) {
    throw new Error(`vested_pay script hash mismatch: rebuilt ${h}, expected ${ESCROW_SCRIPT_HASH}, x402 ${x402Hash}`);
  }
  const addr = scriptAddress(h);
  if (addr !== ESCROW_ADDRESS || addr !== masumiEscrowAddress(NETWORK)) {
    throw new Error(`vested_pay address mismatch: ${addr} != ${ESCROW_ADDRESS}`);
  }
  cached = s;
  return s;
}

/** The unparameterised registry V2 mint policy (policy id 67ab0c92…bd0b). */
export function registryScript(): PlutusV3.PlutusV3 {
  return new PlutusV3.PlutusV3({ bytes: Buffer.from(blueprintCode('registry-v2.plutus.json', 'mint.mintUnique.mint'), 'hex') });
}
