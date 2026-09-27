import test from "node:test";
import assert from "node:assert/strict";
import { encodeBase58 } from "../src/platform/solana/base58.js";
import { decodeUpgradeableProgram, decodeProgramData, decodeSplMint, buildOnreBaseline } from "../src/domains/protocols/onre/baseline.js";

const key = seed => encodeBase58(Uint8Array.from({ length: 32 }, (_, i) => (seed + i) & 255));

function programDataAddressBytes(seed = 1) { return Uint8Array.from({ length: 32 }, (_, i) => seed + i); }

function programAccount(seed = 1) {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  Buffer.from(programDataAddressBytes(seed)).copy(data, 4);
  return { owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: true, lamports: 1, data };
}

function programDataAccount({ slot = 42n, authoritySeed = 90, authority = true } = {}) {
  const data = Buffer.alloc(authority ? 45 : 13);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(slot, 4);
  data[12] = authority ? 1 : 0;
  if (authority) Buffer.from(programDataAddressBytes(authoritySeed)).copy(data, 13);
  return { owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: false, lamports: 1, data };
}

function mintAccount({ mintSeed = 50, freezeSeed = 70, supply = 123456789n, decimals = 9, initialized = true } = {}) {
  const data = Buffer.alloc(82);
  data.writeUInt32LE(1, 0);
  Buffer.from(programDataAddressBytes(mintSeed)).copy(data, 4);
  data.writeBigUInt64LE(supply, 36);
  data[44] = decimals;
  data[45] = initialized ? 1 : 0;
  data.writeUInt32LE(1, 46);
  Buffer.from(programDataAddressBytes(freezeSeed)).copy(data, 50);
  return { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", executable: false, lamports: 1, data };
}

test("decodes upgradeable Program and ProgramData independently of IDL", () => {
  const program = decodeUpgradeableProgram(programAccount(1));
  assert.equal(program.programDataAddress, key(1));
  const state = decodeProgramData(programDataAccount({ slot: 987n, authoritySeed: 90 }));
  assert.equal(state.deploymentSlot, 987);
  assert.equal(state.upgradeAuthority, key(90));
  assert.equal(state.immutable, false);
});

test("program without upgrade authority is explicitly immutable", () => {
  const state = decodeProgramData(programDataAccount({ authority: false }));
  assert.equal(state.upgradeAuthority, null);
  assert.equal(state.immutable, true);
});

test("decodes SPL mint raw supply and both authorities", () => {
  const mint = decodeSplMint(mintAccount());
  assert.equal(mint.rawSupply, "123456789");
  assert.equal(mint.decimals, 9);
  assert.equal(mint.supply, "0.123456789");
  assert.equal(mint.mintAuthority, key(50));
  assert.equal(mint.freezeAuthority, key(70));
  assert.equal(mint.initialized, true);
});

test("builds truthful baseline and unavailable capabilities", async () => {
  const programDataAddress = key(1);
  const rpc = {
    name: "rpc-a",
    getAccount: async address => {
      if (address === "program") return programAccount(1);
      if (address === programDataAddress) return programDataAccount({ slot: 987n, authoritySeed: 90 });
      if (address === "mint") return mintAccount();
      throw new Error("unexpected address");
    },
  };
  const result = await buildOnreBaseline({ programId: "program", mint: "mint", rpcs: [rpc], observedAt: "2026-01-01T00:00:00Z" });
  assert.equal(result.sourceStatus, "single_source");
  assert.equal(result.program.deploymentSlot, 987);
  assert.equal(result.token.rawSupply, "123456789");
  assert.deepEqual(result.monitors.map(x => [x.id, x.status]), [
    ["program-control", "degraded"],
    ["token-control", "degraded"],
    ["protocol-nav", "unavailable"],
    ["market-price", "unavailable"],
    ["capital-movement", "unavailable"],
    ["assisted-exit", "unavailable"],
  ]);
});

test("dual RPC disagreement degrades baseline", async () => {
  const address = key(1);
  const make = slot => ({ name: `rpc-${slot}`, getAccount: async a => a === "program" ? programAccount(1) : a === address ? programDataAccount({ slot: BigInt(slot) }) : mintAccount() });
  const result = await buildOnreBaseline({ programId: "program", mint: "mint", rpcs: [make(10), make(11)], observedAt: "now" });
  assert.equal(result.sourceStatus, "disagreement");
  assert.equal(result.monitors.find(x => x.id === "program-control").status, "degraded");
});
