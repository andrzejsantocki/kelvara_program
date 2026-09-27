import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { inspectIndexer } from "../src/domains/indexer/inspect.js";

function fixtureDb({ withProgramId = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-indexer-"));
  const db = join(dir, "indexer.db");
  const programColumn = withProgramId ? ", program_id TEXT" : "";
  execFileSync("python3", ["-c", `
import sqlite3, sys
p=sys.argv[1]
db=sqlite3.connect(p)
db.executescript('''
CREATE TABLE signatures(signature TEXT PRIMARY KEY, slot INTEGER, block_time INTEGER, block_time_readable TEXT, processed INTEGER);
CREATE TABLE raw_instructions(signature TEXT, instruction_index INTEGER, slot INTEGER, block_time INTEGER, instruction_discriminator TEXT, raw_data TEXT, involved_accounts TEXT, is_inner INTEGER, tx_signer TEXT, tx_success INTEGER${programColumn});
CREATE TABLE raw_accounts(pubkey TEXT, last_updated_slot INTEGER, account_discriminator TEXT, raw_data TEXT, lamports INTEGER);
CREATE TABLE discriminator_list(discriminator TEXT, friendly_name TEXT);
INSERT INTO signatures VALUES ('new', 200, 1000, '1970-01-01T00:16:40.000Z', 1);
INSERT INTO signatures VALUES ('pending', 199, 990, '1970-01-01T00:16:30.000Z', 0);
INSERT INTO signatures VALUES ('failed', 198, 980, '1970-01-01T00:16:20.000Z', -1);
INSERT INTO raw_accounts VALUES ('account', 200, 'abcd', '00', 1);
INSERT INTO discriminator_list VALUES ('abcd', 'test');
''')
cols=['signature','instruction_index','slot','block_time','instruction_discriminator','raw_data','involved_accounts','is_inner','tx_signer','tx_success']
vals=['new',0,200,1000,'abcd','00','[]',0,'signer',1]
if ${withProgramId ? "True" : "False"}:
 cols.append('program_id'); vals.append('program')
q='INSERT INTO raw_instructions ('+','.join(cols)+') VALUES ('+','.join(['?']*len(cols))+')'
db.execute(q,vals)
db.commit(); db.close()
`, db]);
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("inspects source DB read-only and reports truthful lag/work state", () => {
  const fixture = fixtureDb();
  try {
    const result = inspectIndexer(fixture.db, { now: 1020, maxAgeSeconds: 30 });
    assert.equal(result.schema.compatible, true);
    assert.equal(result.schema.hasProgramId, true);
    assert.deepEqual(result.counts, { signatures: 3, processed: 1, pending: 1, failed: 1, rawInstructions: 1, rawAccounts: 1, discriminators: 1 });
    assert.equal(result.head.signature, "new");
    assert.equal(result.head.slot, 200);
    assert.equal(result.freshness.status, "live");
    assert.equal(result.ingestion.caughtUp, false);
    assert.equal(result.ingestion.mode, "polling-source");
  } finally { fixture.cleanup(); }
});

test("flags legacy schema without program_id as incompatible instead of guessing", () => {
  const fixture = fixtureDb({ withProgramId: false });
  try {
    const result = inspectIndexer(fixture.db, { now: 1020, maxAgeSeconds: 30 });
    assert.equal(result.schema.compatible, false);
    assert.equal(result.schema.hasProgramId, false);
    assert.match(result.schema.problems.join(" "), /program_id/);
  } finally { fixture.cleanup(); }
});

test("missing source DB is unavailable", () => {
  const result = inspectIndexer("/definitely/missing/indexer.db", { now: 1020, maxAgeSeconds: 30 });
  assert.equal(result.available, false);
  assert.equal(result.reason, "source_not_found");
});
