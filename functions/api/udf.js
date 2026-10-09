// functions/api/udf.js
// UDF-compatible datafeed backed by Yahoo Finance using the native fetch API.

function toYahooSymbol(udfSymbol) {
  if (!udfSymbol) return 'AAPL';
  const raw = udfSymbol.includes(':') ? udfSymbol.split(':')[1] : udfSymbol;
  // Forex pairs: USDJPY -> USDJPY=X
  if (/^[A-Z]{6}$/.test(raw)) return raw + '=X';
  // Crypto: BTCUSDT -> BTC-USD
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
  const baseUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
  const params = new URLSearchParams({
    interval,
    period1: Math.floor(from / 1000).toString(),
    period2: Math.floor(to / 1000).toString(),
  });
  const url = `${baseUrl}?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TradingView-Datafeed/1.0)',
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    throw new Error('No chart result from Yahoo');
  }

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
      'Cache-Control': 'public, max-age=30',
    },
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (action === 'config') {
      return jsonResponse({
        supports_search: true,
        supports_group_request: false,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        supported_resolutions: ['1','5','15','30','60','240','1D','1W','1M'],
      });
    }

    if (action === 'symbols') {
      const symbol = url.searchParams.get('symbol') || 'FX_IDC:USDJPY';
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
      const symbol = url.searchParams.get('symbol') || 'FX_IDC:USDJPY';
      const resolution = url.searchParams.get('resolution') || '1';
      const from = parseInt(url.searchParams.get('from') || '0', 10);
      const to = parseInt(url.searchParams.get('to') || String(Date.now()), 10);

      const ySymbol = toYahooSymbol(symbol);
      const interval = toYahooInterval(resolution);

      const { t, o, h, l, c, v } = await fetchYahooChart(ySymbol, interval, from, to);

      if (t.length === 0) {
        return jsonResponse({ s: 'no_data' });
      }

      return jsonResponse({ s: 'ok', t, o, h, l, c, v });
    }

    return jsonResponse({ error: 'unknown action', action }, 400);
  } catch (err) {
    console.error('UDF error:', err);
    return jsonResponse({ s: 'error', errmsg: String(err) }, 500);
  }
}
