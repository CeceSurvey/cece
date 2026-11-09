/* ============================================================
 * 测策 · 核心计算模块 core.js
 * 纯函数、无 DOM 依赖，可在浏览器与 Node 中同时运行（便于单元测试）
 * 版权所有 © 2026 陈昱晨（ChaiYiChai）
 * 采用 CC BY-NC 4.0 许可证授权，详见项目根目录 LICENSE 文件
 * ============================================================ */
(function (root) {
  'use strict';

  /* ---------- 数值 ---------- */

  /** 宽松取数：空串 / null / 非数字一律返回 null（而不是 0），避免把"没填"当成"填了 0" */
  function num(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** 定点小数；无效值返回占位符 */
  function fmt(v, dec, dash) {
    if (v === null || v === undefined || !Number.isFinite(v)) return dash === undefined ? '—' : dash;
    return v.toFixed(dec);
  }

  /* ---------- 角度（度分秒） ---------- */

  /**
   * 解析角度输入，返回十进制度（number）；无法解析返回 null。
   * 支持：
   *   45.5            → 45.5°（十进制度）
   *   45 30 30        → 45°30′30″
   *   45°30'30"       → 同上
   *   45°30′30″       → 同上
   *   45:30:30 / 45-30-30 → 同上
   *   45 30           → 45°30′
   */
  function parseAngle(raw) {
    if (raw === null || raw === undefined) return null;
    let s = String(raw).trim();
    if (!s) return null;

    let sign = 1;
    if (s[0] === '-' || s[0] === '−') { sign = -1; s = s.slice(1).trim(); }
    else if (s[0] === '+') { s = s.slice(1).trim(); }

    // 统一各类度分秒符号为空格
    s = s.replace(/[°º˚度]/g, ' ')
         .replace(/[′'’分]/g, ' ')
         .replace(/[″"”秒]/g, ' ');

    const parts = s.split(/[\s:：,，\-]+/).filter(Boolean);
    if (!parts.length || parts.length > 3) return null;

    const nums = parts.map(p => Number(p));
    if (nums.some(n => !Number.isFinite(n))) return null;

    if (nums.length === 1) return sign * nums[0];          // 十进制度

    const [d, m, sec = 0] = nums;
    if (m < 0 || m >= 60 || sec < 0 || sec >= 60) return null;
    return sign * (Math.abs(d) + m / 60 + sec / 3600) * (d < 0 ? -1 : 1);
  }

  /**
   * 十进制度 → 度分秒字符串
   * @param {number} deg
   * @param {number} secDigits 秒保留小数位，默认 0（整秒）
   */
  function formatAngle(deg, secDigits) {
    const k = Math.pow(10, secDigits || 0);
    if (deg === null || deg === undefined || !Number.isFinite(deg)) return '—';

    const neg = deg < 0;
    const totalSec = Math.round(Math.abs(deg) * 3600 * k) / k;

    let d = Math.floor(totalSec / 3600);
    let rest = totalSec - d * 3600;
    let m = Math.floor(rest / 60);
    let s = rest - m * 60;

    // 浮点进位保护：59.9999″ 之类
    if (s >= 60) { s -= 60; m += 1; }
    if (m >= 60) { m -= 60; d += 1; }

    const sd = secDigits || 0;
    const ss = sd ? s.toFixed(sd) : String(Math.round(s));
    return `${neg ? '-' : ''}${d}°${String(m).padStart(2, '0')}′` +
           `${sd ? ss.padStart(sd + 3, '0') : ss.padStart(2, '0')}″`;
  }

  /** 归化到 [0, 360) */
  function norm360(deg) {
    if (!Number.isFinite(deg)) return null;
    let v = deg % 360;
    if (v < 0) v += 360;
    return v;
  }

  /** 两个角度之差，单位：秒（四舍五入到整秒） */
  function angleDiffSec(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    let d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return Math.round(d * 3600);
  }

  /** 角度（圆周量）平均值：用单位矢量求和，避免 359°/1° 跨界出错 */
  function circularMean(vals) {
    const arr = (vals || []).filter(v => Number.isFinite(v));
    if (!arr.length) return null;
    let sx = 0, sy = 0;
    arr.forEach(v => {
      const r = v * Math.PI / 180;
      sx += Math.cos(r);
      sy += Math.sin(r);
    });
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return null;
    return norm360(Math.atan2(sy, sx) * 180 / Math.PI);
  }

  /* ---------- 水准测量 ---------- */

  /**
   * 水准测量数据表计算
   * 每行 = 一个测段：h = 后视 a − 前视 b，H = 起点高程 + 累计高差
   *
   * @param {Array} rows  [{bs, fs, dist, ...}]
   * @param {Object} meta {startH, endH}
   */
  function computeLevel(rows, meta) {
    const startH = num(meta && meta.startH);
    const endH = num(meta && meta.endH);

    let sumA = 0, sumB = 0, sumH = 0;
    let cntA = 0, cntB = 0, cntH = 0;
    let running = startH;

    const out = (rows || []).map(r => {
      const a = num(r.bs);
      const b = num(r.fs);
      let h = null;

      if (a !== null) { sumA += a; cntA++; }
      if (b !== null) { sumB += b; cntB++; }
      if (a !== null && b !== null) { h = a - b; sumH += h; cntH++; }

      let H = null;
      if (h !== null && running !== null) {
        running = running + h;
        H = running;
      }

      return { a, b, h, H, ok: h !== null };
    });

    const known = startH !== null && endH !== null;
    const hMinus = known ? (endH - startH) : null;
    // 闭合差（m）：实测高差总和 − 已知高差
    const closure = (known && cntH) ? (sumH - hMinus) : null;

    return {
      rows: out,
      startH, endH, lastH: running,
      sum: {
        a: cntA ? sumA : null,
        b: cntB ? sumB : null,
        aMinusB: (cntA && cntB) ? (sumA - sumB) : null,
        h: cntH ? sumH : null,
        hMinus,
        closure
      },
      count: { a: cntA, b: cntB, h: cntH }
    };
  }

  /**
   * Σ 视距用的单项距离：后视距 dist + 前视距 fsDist（只填一个时按填的那个算）
   */
  function levelDist(row) {
    const a = num(row && row.dist);
    const b = num(row && row.fsDist);
    if (a === null && b === null) return null;
    return (a || 0) + (b || 0);
  }

  /**
   * 测段距离：后视距与前视距是同一段的两侧读数，取平均才接近该段实际长度
   * （手簿的 Σ视距 = Σ后 + Σ前，除以 2 即为路线长；只有一侧时取该值）
   */
  function levelSegDist(row) {
    const a = num(row && row.dist);
    const b = num(row && row.fsDist);
    if (a === null && b === null) return null;
    if (a === null) return b;
    if (b === null) return a;
    return (a + b) / 2;
  }

  /**
   * 水准测量成果表：把闭合差按距离（缺省按测段数）比例反号分配，求改正后高差与高程
   */
  function computeLevelResult(rows, meta, computed) {
    const lv = computed || computeLevel(rows, meta);
    const startH = lv.startH;
    const closure = lv.sum.closure; // m

    const list = rows || [];
    const dists = list.map(r => levelSegDist(r));
    const useDist = dists.some(d => d !== null && d > 0);

    const weights = list.map((r, i) => {
      if (!lv.rows[i] || !lv.rows[i].ok) return 0;
      if (!useDist) return 1;
      const d = dists[i];
      return (d !== null && d > 0) ? d : 0;
    });
    const sumW = weights.reduce((s, w) => s + w, 0);

    const out = [];
    let running = startH;
    let sumV = 0, sumHAdj = 0, sumHReal = 0;

    list.forEach((r, i) => {
      const base = lv.rows[i] || { h: null };
      const h = base.h;
      let v = null, hAdj = null, H = null;

      if (h !== null) {
        sumHReal += h;
        if (closure !== null && sumW > 0) {
          v = -(closure * 1000) * (weights[i] / sumW);  // mm
        } else {
          v = 0;
        }
        hAdj = h + v / 1000;
        sumV += v;
        sumHAdj += hAdj;

        if (running !== null) {
          running = running + hAdj;
          H = running;
        }
      }

      out.push({
        h, v, hAdj, H,
        dist: dists[i],
        weight: weights[i],
        ok: h !== null
      });
    });

    return {
      rows: out,
      useDist,
      sum: {
        h: lv.sum.h,
        v: sumV,
        hAdj: sumHAdj,
        H: running,
        closure,
        closureMm: closure === null ? null : closure * 1000
      }
    };
  }

  /* ---------- 角度测量（测回法） ---------- */

  const ANGLE_LIMITS = {
    halfTurn: 40,   // 半测回较差限差（秒），J6 经纬仪/全站仪常用
    turnGap: 24     // 测回间较差限差（秒）
  };

  /**
   * 角度测量数据 → 成果
   * 每行 = 一个测回，读数顺序：A 盘左、B 盘左、A 盘右、B 盘右
   *   βL = B盘左 − A盘左，βR = B盘右 − A盘右
   *   一测回角值 = mean(βL, βR)
   *   各测回平均角值 = 所有有效一测回角值的圆周平均
   */
  function computeAngle(rows) {
    const list = rows || [];

    const base = list.map(r => {
      const aL = parseAngle(r.aL);
      const bL = parseAngle(r.bL);
      const aR = parseAngle(r.aR);
      const bR = parseAngle(r.bR);

      const beL = (aL !== null && bL !== null) ? norm360(bL - aL) : null;
      const beR = (aR !== null && bR !== null) ? norm360(bR - aR) : null;
      const halfDiff = (beL !== null && beR !== null) ? angleDiffSec(beL, beR) : null;
      const one = (beL !== null && beR !== null)
        ? circularMean([beL, beR])
        : (beL !== null ? beL : beR);

      return {
        aL, bL, aR, bR, beL, beR, halfDiff, one,
        station: String(r.station == null ? '' : r.station).trim(),
        stNo: Number.isFinite(Number(r.stNo)) && r.stNo !== '' && r.stNo != null
          ? Math.max(1, Math.round(Number(r.stNo)))
          : null
      };
    });

    // 没有测站号的老数据：按「站名变化」推断站号
    let runNo = 0, prevName = null;
    base.forEach((b, i) => {
      if (b.stNo === null) {
        if (i === 0 || b.station !== prevName) runNo += 1;
        b.stNo = runNo;
      } else {
        runNo = b.stNo;
      }
      prevName = b.station;
    });

    // 按测站分块：同一测站号（连续）的多个测回归为一组，各站各算各的平均角值
    const groups = [];
    base.forEach(b => {
      const last = groups.length ? groups[groups.length - 1] : null;
      if (last && last.stNo === b.stNo) last.items.push(b);
      else groups.push({ stNo: b.stNo, station: b.station, items: [b] });
    });

    groups.forEach(g => {
      g.avg = circularMean(g.items.map(x => x.one));
      g.valid = g.items.filter(x => x.one !== null).length;
      g.items.forEach(x => {
        x.groupAvg = g.avg;
        x.gap = (x.one !== null && g.avg !== null) ? angleDiffSec(x.one, g.avg) : null;
      });
    });

    const avg = groups.length === 1 ? groups[0].avg : circularMean(groups.map(g => g.avg));

    const rowsOut = base.map(b => ({
      ...b,
      gap: b.gap === undefined ? null : b.gap,
      avg: b.groupAvg === undefined ? null : b.groupAvg
    }));

    const overHalf = rowsOut.filter(r => r.halfDiff !== null && Math.abs(r.halfDiff) > ANGLE_LIMITS.halfTurn).length;
    const overGap = rowsOut.filter(r => r.gap !== null && Math.abs(r.gap) > ANGLE_LIMITS.turnGap).length;

    return {
      rows: rowsOut,
      avg,
      groups,
      valid: base.filter(b => b.one !== null).length,
      check: {
        overHalf,
        overGap,
        halfLimit: ANGLE_LIMITS.halfTurn,
        gapLimit: ANGLE_LIMITS.turnGap,
        maxHalf: rowsOut.reduce((m, r) => (r.halfDiff !== null && Math.abs(r.halfDiff) > m ? Math.abs(r.halfDiff) : m), 0),
        maxGap: rowsOut.reduce((m, r) => (r.gap !== null && Math.abs(r.gap) > m ? Math.abs(r.gap) : m), 0)
      }
    };
  }

  /* ---------- 点位类型：关键词匹配 ---------- */

  /**
   * 用备注文本匹配点位类型
   * @returns {{typeId:string|null, matches:Array, conflict:boolean}}
   *   唯一命中 → typeId 为该类型；命中多个 → conflict=true 且 typeId=null（不做二次分类）
   */
  function matchPointType(remark, types) {
    const text = String(remark == null ? '' : remark).toLowerCase();
    const list = types || [];
    if (!text.trim()) return { typeId: null, matches: [], conflict: false };

    const matches = list.filter(t =>
      (t.keywords || []).some(k => {
        const kw = String(k == null ? '' : k).trim().toLowerCase();
        return kw && text.indexOf(kw) >= 0;
      })
    );

    if (matches.length === 1) return { typeId: matches[0].id, matches, conflict: false };
    if (matches.length > 1) return { typeId: null, matches, conflict: true };
    return { typeId: null, matches, conflict: false };
  }

  /* ---------- 点号预测 ---------- */

  /**
   * 预测下一个点号：向上找最近一个非空点号，若为纯数字则 +1
   * @returns {string} 预测值，无法预测时为空串
   */
  function predictNo(rows, index) {
    const list = rows || [];
    for (let i = Math.min(index - 1, list.length - 1); i >= 0; i--) {
      const v = String(list[i] && list[i].no != null ? list[i].no : '').trim();
      if (!v) continue;
      if (!/^\d+$/.test(v)) return '';
      // 前导零保留位数，例如 007 → 008
      const digits = v.length > 1 && v[0] === '0' ? v.length : 0;
      const next = String(parseInt(v, 10) + 1);
      return digits ? next.padStart(digits, '0') : next;
    }
    return '';
  }

  /* ---------- 导出 ---------- */
  const Core = {
    num, fmt,
    parseAngle, formatAngle, norm360, angleDiffSec, circularMean,
    computeLevel, computeLevelResult, levelDist, levelSegDist,
    computeAngle, ANGLE_LIMITS,
    matchPointType, predictNo
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.CeceCore = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
