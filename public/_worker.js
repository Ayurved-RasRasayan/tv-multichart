// public/_worker.js
// Advanced Mode Pages Worker - handles /api/udf + serves static assets

function toYahooSymbol(udfSymbol) {
  if (!udfSymbol) return 'AAPL';
  const raw = udfSymbol.includes(':') ? udfSymbol.split(':')[1] : udfSymbol;
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
  // UDF sends unix SECONDS. Yahoo v8 also wants unix SECONDS.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&period1=${from}&period2=${to}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradingView-Datafeed/1.0)' },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Yahoo API error: ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('No chart result from Yahoo');
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
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/udf')) {
      const action = url.searchParams.get('action');
      try {
        if (action === 'config') {
          return jsonResponse({
            supports_search: true, supports_group_request: false,
            supports_marks: false, supports_timescale_marks: false,
            supports_time: true,
            supported_resolutions: ['1','5','15','30','60','240','1D','1W','1M'],
          });
        }
        if (action === 'symbols') {
          const symbol = url.searchParams.get('symbol') || 'FX_IDC:USDJPY';
          const raw = symbol.includes(':') ? symbol.split(':')[1] : symbol;
          return jsonResponse({
            name: raw, ticker: symbol, description: raw, type: 'forex',
            session: '24x7', exchange: 'YAHOO', listed_exchange: 'YAHOO',
            timezone: 'Etc/UTC', has_intraday: true, has_daily: true,
            has_weekly_and_monthly: true, minmov: 1,
            pricescale: raw.includes('JPY') ? 100 : 100000,
            supported_resolutions: ['1','5','15','30','60','240','1D','1W','1M'],
          });
        }
        if (action === 'history') {
          const symbol = url.searchParams.get('symbol') || 'FX_IDC:USDJPY';
          const resolution = url.searchParams.get('resolution') || '1';
          const from = parseInt(url.searchParams.get('from') || '0', 10);
          const to = parseInt(url.searchParams.get('to') || String(Math.floor(Date.now()/1000)), 10);
          const { t, o, h, l, c, v } = await fetchYahooChart(
            toYahooSymbol(symbol), toYahooInterval(resolution), from, to
          );
          if (t.length === 0) return jsonResponse({ s: 'no_data' });
          return jsonResponse({ s: 'ok', t, o, h, l, c, v });
        }
        return jsonResponse({ error: 'unknown action', action }, 400);
      } catch (err) {
        return jsonResponse({ s: 'error', errmsg: String(err) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
