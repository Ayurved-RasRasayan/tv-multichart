// public/_worker.js
// UDF-compatible datafeed. Handles path-based and query-based actions.
// Supports server-side aggregation for intervals Yahoo doesn't provide natively.

function toYahooSymbol(udfSymbol) {
  if (!udfSymbol) return 'AAPL';
  const raw = udfSymbol.includes(':') ? udfSymbol.split(':')[1] : udfSymbol;
  if (raw === 'USDJPY') return 'JPY=X';
  if (/^[A-Z]{6}$/.test(raw)) return raw + '=X';
  if (/USDT$/.test(raw)) return raw.replace('USDT', '') + '-USD';
  return raw;
}

// Native Yahoo intervals mapped to their base (non-aggregated) resolution.
// When we can't fetch the requested interval directly, we fetch the base
// and aggregate client-side (in the worker).
const NATIVE_INTERVALS = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m',
  '60': '1h', '240': '1d',
  '1D': '1d', '1W': '1wk', '1M': '1mo',
};

// Intervals we synthesize by aggregating 1-minute bars.
// key = UDF resolution string, value = number of 1m bars per output bar
const AGGREGATED_INTERVALS = {
  '2': 2,
  '3': 3,
  '4': 4,
  '10': 10,
  '45': 45,
};

function toYahooInterval(resolution) {
  const res = String(resolution);
  if (NATIVE_INTERVALS[res]) return NATIVE_INTERVALS[res];
  if (AGGREGATED_INTERVALS[res]) return '1m'; // fetch base, aggregate later
  return '1d';
}

async function fetchYahooChart(symbol, interval, from, to) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&period1=${from}&period2=${to}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradingView-Datafeed/1.0)',
      'Accept': 'application/json',
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data) throw new Error(`Yahoo ${res.status} for ${symbol} | body=${text.slice(0,150)}`);
  if (data?.chart?.error) throw new Error(`Yahoo error: ${JSON.stringify(data.chart.error)}`);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No chart result for ${symbol}`);

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const { open, high, low, close, volume } = quote;
  const t = [], o = [], h = [], l = [], c = [], v = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (open[i] == null || close[i] == null) continue;
    t.push(timestamps[i]);
    o.push(open[i]);
    h.push(high[i] ?? open[i]);
    l.push(low[i] ?? open[i]);
    c.push(close[i]);
    v.push(volume[i] ?? 0);
  }
  return { t, o, h, l, c, v };
}

// Group bars of size `groupSize` seconds. Assumes bars are aligned to
// groupSize boundaries (e.g., 3m bars at :00/:03/:06...).
function aggregate(bars, groupSec) {
  const { t, o, h, l, c, v } = bars;
  if (t.length === 0) return bars;

  const out = { t: [], o: [], h: [], l: [], c: [], v: [] };
  let bucketTs = null;
  let curO = 0, curH = -Infinity, curL = Infinity, curC = 0, curV = 0;

  for (let i = 0; i < t.length; i++) {
    const b = Math.floor(t[i] / groupSec) * groupSec;
    if (bucketTs === null) bucketTs = b;

    if (b !== bucketTs) {
      // flush previous bucket
      out.t.push(bucketTs);
      out.o.push(curO);
      out.h.push(curH);
      out.l.push(curL);
      out.c.push(curC);
      out.v.push(curV);
      // start new
      bucketTs = b;
      curO = o[i]; curH = h[i]; curL = l[i]; curC = c[i]; curV = v[i];
    } else {
      // merge into current
      curH = Math.max(curH, h[i]);
      curL = Math.min(curL, l[i]);
      curC = c[i];
      curV += v[i];
    }
  }

  // flush last bucket
  if (bucketTs !== null) {
    out.t.push(bucketTs);
    out.o.push(curO);
    out.h.push(curH);
    out.l.push(curL);
    out.c.push(curC);
    out.v.push(curV);
  }

  return out;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
    },
  });
}

function detectAction(url, pathname) {
  const q = url.searchParams.get('action');
  if (q) return q;
  const m = pathname.match(/^\/api\/udf\/([a-z]+)$/i);
  if (m) return m[1].toLowerCase();
  if (pathname === '/api/udf' || pathname === '/api/udf/') return 'config';
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    if (!pathname.startsWith('/api/udf')) {
      return env.ASSETS.fetch(request);
    }

    let bodyParams = {};
    if (request.method === 'POST') {
      try { bodyParams = await request.json(); } catch {}
    }

    const action = detectAction(url, pathname) || bodyParams.action;

    try {
      if (action === 'config') {
        return jsonResponse({
          exchanges: [],
          supports_search: true,
          supports_group_request: false,
          supports_marks: false,
          supports_timescale_marks: false,
          supports_time: true,
          symbols_types: [],
          supported_resolutions: [
            '1','2','3','4','5','10','15','30','45','60','240','1D','1W','1M'
          ],
        });
      }

      if (action === 'symbols') {
        const symbol = url.searchParams.get('symbol') || bodyParams.symbol || 'FX_IDC:USDJPY';
        const raw = symbol.includes(':') ? symbol.split(':')[1] : symbol;
        return jsonResponse({
          name: raw, ticker: symbol, description: raw, type: 'forex',
          session: '24x7', exchange: 'YAHOO', listed_exchange: 'YAHOO',
          timezone: 'Etc/UTC', has_intraday: true, has_daily: true,
          has_weekly_and_monthly: true, minmov: 1,
          pricescale: raw.includes('JPY') ? 100 : 100000,
          supported_resolutions: [
            '1','2','3','4','5','10','15','30','45','60','240','1D','1W','1M'
          ],
        });
      }

      if (action === 'history') {
        const symbol     = url.searchParams.get('symbol')     || bodyParams.symbol     || 'FX_IDC:USDJPY';
        const resolution = String(url.searchParams.get('resolution') || bodyParams.resolution || '1');
        const fromReq    = parseInt(url.searchParams.get('from') || bodyParams.from || '0', 10);
        const toReq      = parseInt(url.searchParams.get('to')   || bodyParams.to   || '0', 10);

        const serverNow = Math.floor(Date.now() / 1000);
        const windowSec = Math.max(60, (toReq || serverNow) - (fromReq || 0));
        let safeTo   = Math.min(toReq || serverNow, serverNow);
        let safeFrom = safeTo - windowSec;
        if (safeFrom < 0) safeFrom = 0;

        // If we need to aggregate, over-fetch 1m bars covering the window
        // plus a small buffer at the start so the first output bar is complete.
        const groupSize = AGGREGATED_INTERVALS[resolution];
        const fetchFrom = groupSize ? safeFrom - groupSize * 60 : safeFrom;

        const ySymbol = toYahooSymbol(symbol);
        const yInterval = toYahooInterval(resolution);

        console.log(`[UDF] ${symbol} res=${resolution} -> yahoo=${yInterval}${groupSize ? ' agg=' + groupSize : ''} window=${safeFrom}-${safeTo}`);

        const raw = await fetchYahooChart(ySymbol, yInterval, fetchFrom, safeTo);

        const out = groupSize ? aggregate(raw, groupSize * 60) : raw;

        // Trim any output bars before the requested from
        if (out.t.length && out.t[0] < safeFrom) {
          let cut = 0;
          while (cut < out.t.length && out.t[cut] < safeFrom) cut++;
          if (cut > 0) {
            out.t = out.t.slice(cut);
            out.o = out.o.slice(cut);
            out.h = out.h.slice(cut);
            out.l = out.l.slice(cut);
            out.c = out.c.slice(cut);
            out.v = out.v.slice(cut);
          }
        }

        if (out.t.length === 0) return jsonResponse({ s: 'no_data' });
        return jsonResponse({ s: 'ok', t: out.t, o: out.o, h: out.h, l: out.l, c: out.c, v: out.v });
      }

      if (action === 'search') return jsonResponse([]);

      return jsonResponse({ error: 'unknown action', action, pathname }, 404);
    } catch (err) {
      return jsonResponse({ s: 'error', errmsg: String(err) }, 500);
    }
  },
};
