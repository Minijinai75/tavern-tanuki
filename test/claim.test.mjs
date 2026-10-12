// 代玩牌（26-10-13）：兩隻小狸搶同一個埠，牌寫誰線就歸誰、改牌五拍內換手、收牌不趕人。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Bridge } from '../src/bridge.js';
import { clearClaim, mayHold, readClaim, writeClaim } from '../src/claim.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(20);
  }
  return fn();
}

test('mayHold：沒牌誰都可以、有牌只有牌主可以、沒名字的窗在有牌時不行', () => {
  assert.equal(mayHold(null, '承曦'), true);
  assert.equal(mayHold({ who: '沐晴' }, '沐晴'), true);
  assert.equal(mayHold({ who: '沐晴' }, '承曦'), false);
  assert.equal(mayHold({ who: '沐晴' }, ''), false);
});

test('牌檔：寫讀清；壞檔與空名字當沒牌', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tanuki-claim-'));
  const f = path.join(dir, '代玩牌.json');
  assert.equal(readClaim(f), null);
  const o = writeClaim(' 沐晴 ', '承曦', f);
  assert.equal(o.who, '沐晴');
  assert.equal(readClaim(f).who, '沐晴');
  assert.throws(() => writeClaim('  ', 'x', f));
  assert.equal(clearClaim(f), true);
  assert.equal(readClaim(f), null);
  rmSync(dir, { recursive: true, force: true });
});

test('兩隻小狸：沒牌先到先拿；寫牌換手；改回來再換手；收牌不趕人', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tanuki-claim-'));
  const f = path.join(dir, '代玩牌.json');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const A = new Bridge(port, { me: '霽野', claimFile: f, pollMs: 60 });
  assert.ok(await until(() => A.holding), 'A 先綁');
  const B = new Bridge(port, { me: '沐晴', claimFile: f, pollMs: 60 });
  await sleep(250);
  assert.equal(B.holding, false, '埠被 A 拿著，B 排隊');
  assert.equal(A.holding, true);

  writeClaim('沐晴', '測試', f);
  assert.ok(await until(() => !A.holding && B.holding), '牌寫沐晴 → A 放、B 拿');
  assert.equal(B.status().holder, '沐晴');
  assert.throws(() => A.call('status'), /代玩牌在「沐晴」手上/);

  writeClaim('霽野', '測試', f);
  assert.ok(await until(() => A.holding && !B.holding), '牌改霽野 → B 放、A 拿');

  clearClaim(f);
  await sleep(250);
  assert.equal(A.holding, true, '收牌：拿著的不放');
  assert.equal(B.holding, false);

  A.close();
  assert.ok(await until(() => B.holding), 'A 關掉 → B 補位');
  B.close();
  rmSync(dir, { recursive: true, force: true });
});
