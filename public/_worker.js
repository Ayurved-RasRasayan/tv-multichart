// public/_worker.js
// UDF-compatible datafeed. Handles both path-based and query-based actions.

function toYahooSymbol(udfSymbol) {
  if (!udfSymbol) return 'AAPL';
  const raw = udfSymbol.includes(':') ? udfSymbol.split(':')[1] : udfSymbol;
  if (raw === 'USDJPY') return 'JPY=X';
  if (/^[A-Z]{6}$/.test(raw)) return raw + '=X';
  if (/USDT$/.test(raw)) return raw.replace('USDT', '') + '-USD';
  return raw;
}

function toYahooInterval(resolution) {
  const map = {
    '1': '1m', '3': '1m', '5': '5m', '15': '15m',
    '30': '30m', '60': '1h', '240': '1d',
    '1D': '1d', '1W': '1wk', '1M': '1mo',
  };
  return map[String(resolution)] || '1d';
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
    console.log(`[UDF] pathname=${pathname} action=${action} method=${request.method}`);

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
          supported_resolutions: ['1','5','15','30','60','240','1D','1W','1M'],
        });
      }

      if (action === 'symbols') {
        const symbol = url.searchParams.get('symbol') || bodyParams.symbol || 'FX_IDC:USDJPY';
        const raw = symbol.includes(':') ? symbol.split(':')[1] : symbol;
        return jsonResponse({
          name: raw,
          ticker: symbol,
          description: raw,
          type: 'forex',
          session: '24x7',
          exchange: 'YAHOO',
          listed_exchange: 'YAHOO',
          timezone: 'Etc/UTC',
          has_intraday: true,
          has_daily: true,
          has_weekly_and_monthly: true,
          minmov: 1,
          pricescale: raw.includes('JPY') ? 100 : 100000,
          supported_resolutions: ['1','5','15','30','60','240','1D','1W','1M'],
        });
      }

      if (action === 'history') {
        const symbol = url.searchParams.get('symbol') || bodyParams.symbol || 'FX_IDC:USDJPY';
        const resolution = url.searchParams.get('resolution') || bodyParams.resolution || '1';
        const fromReq = parseInt(url.searchParams.get('from') || bodyParams.from || '0', 10);
        const toReq   = parseInt(url.searchParams.get('to')   || bodyParams.to   || '0', 10);

        const serverNow = Math.floor(Date.now() / 1000);
        const windowSec = Math.max(60, (toReq || serverNow) - (fromReq || 0));
        let safeTo   = Math.min(toReq || serverNow, serverNow);
        let safeFrom = safeTo - windowSec;
        if (safeFrom < 0) safeFrom = 0;

        const { t, o, h, l, c, v } = await fetchYahooChart(
          toYahooSymbol(symbol), toYahooInterval(resolution), safeFrom, safeTo
        );
        if (t.length === 0) return jsonResponse({ s: 'no_data' });
        return jsonResponse({ s: 'ok', t, o, h, l, c, v });
      }

      if (action === 'search') {
        return jsonResponse([]);
      }

      return jsonResponse({ error: 'unknown action', action, pathname }, 404);
    } catch (err) {
      return jsonResponse({ s: 'error', errmsg: String(err) }, 500);
    }
  },
};
