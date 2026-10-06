// Measures the real on-chain execution units of a settlement with N pledges:
// the compiled (silent-trace) bloc script, applied to a test campaign policy, is
// evaluated with `aiken uplc eval` on full V3 ScriptContexts dumped by the
// `ctx_nN` tests in contracts/bloc/validators/bloc_test.ak (1 withdraw + N spends).
//   pnpm --filter @overpaid/bloc-contract measure
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Bytes, CBOR, Data } from "@evolution-sdk/evolution";

const dir = fileURLToPath(new URL("../../../contracts/bloc/", import.meta.url));
const sh = (args: string[]) => execFileSync("aiken", args, { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });

function show(d: Data.Data): string {
  if (typeof d === "bigint") return `I ${d}`;
  if (d instanceof Uint8Array) return `B #${Bytes.toHex(d)}`;
  if (Array.isArray(d)) return `List [${d.map(show).join(", ")}]`;
  if (d instanceof Map) return `Map [${[...d.entries()].map(([k, v]) => `(${show(k)}, ${show(v)})`).join(", ")}]`;
  if (d instanceof Data.Constr) return `Constr ${d.index} [${d.fields.map(show).join(", ")}]`;
  throw new Error("unknown data");
}

sh(["build"]);
sh(["blueprint", "apply", "-m", "bloc", "-v", "bloc", "581c" + "c0".repeat(28), "-o", "build/applied-c0.json"]);
const applied = JSON.parse(readFileSync(dir + "build/applied-c0.json", "utf8"));
writeFileSync(dir + "build/bloc-c0.cbor", applied.validators.find((v: { title: string }) => v.title === "bloc.bloc.withdraw").compiledCode);

const eval1 = (cborHex: string) => {
  const term = `(con data (${show(Data.fromCBORHex(cborHex.toLowerCase(), CBOR.AIKEN_DEFAULT_OPTIONS))}))`;
  const out = execFileSync("aiken", ["uplc", "eval", "-c", "build/bloc-c0.cbor", term], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  if (!String(j.result).includes("con unit")) throw new Error("script failed: " + out);
  return { mem: BigInt(j.mem), cpu: BigInt(j.cpu) };
};

const LIMIT_MEM = 17_500_000n, LIMIT_CPU = 10_000_000_000n;
const ns = (process.argv[2] ?? "1,5,10,20,30,40,50").split(",").map(Number);
console.log("N  | withdraw mem / cpu        | N spends mem / cpu          | total mem (% of 17.5M) / cpu (% of 10B)");
for (const n of ns) {
  const res = JSON.parse(sh(["check", "-e", "-m", `ctx_n${n}`]));
  const traces: string[] = res.modules.flatMap((m: { tests: Array<{ traces?: string[] }> }) => m.tests.flatMap((t) => t.traces ?? []));
  const w = traces.filter((t) => t.startsWith("withdraw: ")).map((t) => eval1(t.slice(10)));
  const s = traces.filter((t) => t.startsWith("spend: ")).map((t) => eval1(t.slice(7)));
  const sum = (xs: Array<{ mem: bigint; cpu: bigint }>) => xs.reduce((a, b) => ({ mem: a.mem + b.mem, cpu: a.cpu + b.cpu }), { mem: 0n, cpu: 0n });
  const W = sum(w), S = sum(s), T = sum([W, S]);
  const pct = (a: bigint, b: bigint) => ((Number(a) / Number(b)) * 100).toFixed(1);
  console.log(`${String(n).padEnd(3)}| ${W.mem} / ${W.cpu} | ${S.mem} / ${S.cpu} | ${T.mem} (${pct(T.mem, LIMIT_MEM)}%) / ${T.cpu} (${pct(T.cpu, LIMIT_CPU)}%)`);
}
