/**
 * 代玩牌（26-10-13 承曦，沐晴投件：每扇窗都帶一隻小狸、6700 誰先綁誰拿，想把線交給指定的窗只能關窗碰運氣）。
 *
 * 一張 JSON 檔寫「線歸誰」。每隻小狸每 5 秒看一次：
 *   - 沒牌 → 照舊，誰先綁到 6700 誰拿；
 *   - 牌上是我 → 我綁（埠被佔就每 5 秒再試，牌主以外的實例會自己放）；
 *   - 牌上不是我 → 我不綁；正拿著就放掉。
 * 「我」＝環境變數 TANUKI_WHO，沒有就用 MINI_AGENT（家裡開窗都帶）。兩個都沒有的窗在有牌時永遠不綁。
 * 檔放 %LOCALAPPDATA%\MiniJinLab\tavern-tanuki\，刻意不放在會被雲端硬碟同步的夾（同步會把舊版寫回來，26-09-17 存檔鎖案）。
 */
import fs from 'node:fs';
import path from 'node:path';

export const CLAIM_FILE =
  process.env.TANUKI_CLAIM_FILE ||
  path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'MiniJinLab', 'tavern-tanuki', '代玩牌.json');

export const me = () => process.env.TANUKI_WHO || process.env.MINI_AGENT || '';

export function readClaim(file = CLAIM_FILE) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    return o && typeof o.who === 'string' && o.who.trim() ? { who: o.who.trim(), by: o.by ?? null, at: o.at ?? null } : null;
  } catch {
    return null;
  }
}

export function writeClaim(who, by = '', file = CLAIM_FILE) {
  if (typeof who !== 'string' || !who.trim()) throw new Error('代玩牌要寫名字（who）');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const o = { who: who.trim(), by, at: new Date().toISOString() };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(o));
  fs.renameSync(tmp, file);
  return o;
}

export function clearClaim(file = CLAIM_FILE) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** 這扇該不該拿線：沒牌＝可以；有牌＝只有牌上那家可以。 */
export function mayHold(claim, who) {
  return !claim || claim.who === who;
}
