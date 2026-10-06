import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Bytes, Data } from "@evolution-sdk/evolution";
import { describe, expect, it } from "vitest";
import {
  bidMessage,
  blocAddress,
  blocScript,
  campaignPolicy,
  decodeCampaignDatum,
  decodePledgeDatum,
  loadBlueprint,
  campaignDatumData,
  pledgeDatumData,
  plutusAddressFromBech32,
  plutusAddressToBech32,
  settlementAmounts,
  signBid,
  verifyBid,
} from "../src/index.js";
import { vectors } from "../scripts/gen-vectors.js";
import { BID1, BID2, BID3, CAMPAIGN, CAMPAIGN_POLICY, PLEDGE0, PROVIDER_ADDRESS, SK1, SK2, VK1 } from "./fixtures.js";
import stored from "./bid-vectors.json" with { type: "json" };
import applyVectors from "./apply-vectors.json" with { type: "json" };

const contractDir = fileURLToPath(new URL("../../../contracts/bloc/", import.meta.url));
const aikenTests = readFileSync(contractDir + "validators/bloc_test.ak", "utf8");

describe("bid message and ed25519 (cross-checked with Aiken)", () => {
  it("regenerated vectors equal the stored ones", () => {
    expect(vectors()).toEqual(stored);
  });

  it("every vector is hardcoded verbatim in the Aiken tests (which assert bid_message == msg, verify(sig), cbor == hex)", () => {
    for (const [k, v] of Object.entries(stored)) {
      if (k === "msg2") continue; // msg2 is only signed, not compared on chain
      expect(aikenTests, k).toContain(`#"${v}"`);
    }
  });

  it("has the documented fixed layout", () => {
    const m = bidMessage(CAMPAIGN_POLICY, BID1);
    expect(m.length).toBe(221);
    expect(new TextDecoder().decode(m.slice(0, 8))).toBe("BLOCBID1");
    expect(Bytes.toHex(m.slice(8, 36))).toBe(CAMPAIGN_POLICY);
    expect(m[36]).toBe(11); // len("esim-eu-30d")
    // tail: provider_vkey(32) ‖ 0x00 ‖ payment(28) ‖ 0x01 ‖ stake(28)
    expect(Bytes.toHex(m.slice(-90, -58))).toBe(VK1);
    expect(m[m.length - 58]).toBe(0x00);
    expect(m[m.length - 29]).toBe(0x01);
    // script payment, no stake
    const m3 = bidMessage(CAMPAIGN_POLICY, BID3);
    expect(Bytes.toHex(m3.slice(-30))).toBe("01" + "b3".repeat(28) + "00");
  });

  it("signs deterministically and verifies", () => {
    const sig = signBid(SK1, CAMPAIGN_POLICY, BID1);
    expect(sig).toBe(stored.sig1);
    expect(verifyBid(CAMPAIGN_POLICY, BID1, sig)).toBe(true);
    expect(verifyBid(CAMPAIGN_POLICY, BID2, signBid(SK2, CAMPAIGN_POLICY, BID2))).toBe(true);
  });

  it("rejects tampering, wrong campaign, bad lengths", () => {
    const sig = stored.sig1;
    expect(verifyBid(CAMPAIGN_POLICY, { ...BID1, unitPrice: BID1.unitPrice - 1n }, sig)).toBe(false);
    expect(verifyBid("c1".repeat(28), BID1, sig)).toBe(false);
    expect(verifyBid(CAMPAIGN_POLICY, BID1, sig.slice(0, 126))).toBe(false);
    expect(verifyBid(CAMPAIGN_POLICY, { ...BID1, providerVkey: "00" }, sig)).toBe(false);
    expect(() => signBid(SK2, CAMPAIGN_POLICY, BID1)).toThrow();
    expect(() => bidMessage(CAMPAIGN_POLICY, { ...BID1, unitPrice: -1n })).toThrow();
  });
});

describe("parameter application == aiken blueprint apply", () => {
  const bp = loadBlueprint();
  const seed = { txHash: "5e".repeat(32), index: 1 };

  it("matches the stored apply vectors", () => {
    const pol = campaignPolicy(seed, bp);
    expect(pol.hash).toBe(applyVectors.campaign_policy);
    const bloc = blocScript(pol.hash, bp);
    expect(bloc.hash).toBe(applyVectors.bloc_hash);
    expect(blocAddress(bloc.hash, 0)).toBe(applyVectors.bloc_address);
  });

  let hasAiken = true;
  try {
    execFileSync("aiken", ["--version"], { stdio: "ignore" });
  } catch {
    hasAiken = false;
  }

  it.skipIf(!hasAiken)("matches a live `aiken blueprint apply` (code bytes and hashes)", () => {
    const run = (args: string[]) => execFileSync("aiken", args, { cwd: contractDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    run(["blueprint", "apply", "-m", "campaign", "-v", "campaign", `d8799f5820${seed.txHash}01ff`, "-o", "build/test-campaign.json"]);
    const policy = run(["blueprint", "policy", "-i", "build/test-campaign.json", "-m", "campaign", "-v", "campaign"]);
    run(["blueprint", "apply", "-m", "bloc", "-v", "bloc", `581c${policy}`, "-o", "build/test-bloc.json"]);
    const blocHash = run(["blueprint", "hash", "-i", "build/test-bloc.json", "-m", "bloc", "-v", "bloc"]);
    const address = run(["blueprint", "address", "-i", "build/test-bloc.json", "-m", "bloc", "-v", "bloc"]);

    const pol = campaignPolicy(seed, bp);
    const bloc = blocScript(pol.hash, bp);
    expect(pol.hash).toBe(policy);
    expect(bloc.hash).toBe(blocHash);
    expect(blocAddress(bloc.hash, 0)).toBe(address);
    const applied = JSON.parse(readFileSync(contractDir + "build/test-bloc.json", "utf8"));
    expect(bloc.compiledCode).toBe(applied.validators.find((v: { title: string }) => v.title === "bloc.bloc.withdraw").compiledCode);
  });
});

describe("datums and addresses", () => {
  it("round-trips pledge and campaign datums", () => {
    expect(decodePledgeDatum(pledgeDatumData(PLEDGE0))).toEqual(PLEDGE0);
    expect(decodeCampaignDatum(campaignDatumData(CAMPAIGN))).toEqual(CAMPAIGN);
    expect(() => decodePledgeDatum(Data.constr(0n, [Data.int(1n)]))).toThrow();
  });

  it("round-trips bech32 <-> Plutus address", () => {
    const bech = plutusAddressToBech32(PROVIDER_ADDRESS, 0);
    expect(bech.startsWith("addr_test1q")).toBe(true);
    expect(plutusAddressFromBech32(bech)).toEqual(PROVIDER_ADDRESS);
  });

  it("computes settlement amounts", () => {
    const r = settlementAmounts([{ quantity: 2n, lockedAsset: 10_000_000n }, { quantity: 1n, lockedAsset: 5_000_000n }], 4_000_000n);
    expect(r.providerTotal).toBe(12_000_000n);
    expect(r.perPledge.map((p) => p.refundAsset)).toEqual([2_000_000n, 1_000_000n]);
  });
});
