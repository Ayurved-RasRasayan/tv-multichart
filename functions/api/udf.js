// functions/api/udf.js
// UDF-compatible datafeed backed by Yahoo Finance.

import yahooFinance from 'yahoo-finance2';

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
      const ySymbol = toYahooSymbol(symbol);
      let quote = null;
      try { quote = await yahooFinance.quote(ySymbol); } catch {}
      return jsonResponse({
        name: raw,
        ticker: symbol,
        description: quote?.longName || quote?.shortName || raw,
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

    if (action === 'search') {
      const query = url.searchParams.get('query') || 'USDJPY';
      let results = [];
      try {
        const r = await yahooFinance.search(query);
        results = (r.quotes || []).slice(0, 10).map((q) => ({
          symbol: q.symbol,
          full_name: q.longname || q.shortname || q.symbol,
          description: q.longname || q.shortname || q.symbol,
          exchange: q.exchange || 'YAHOO',
          type: q.quoteType || 'forex',
        }));
      } catch {}
      return jsonResponse(results);
    }

    if (action === 'history') {
      const symbol = url.searchParams.get('symbol') || 'FX_IDC:USDJPY';
      const resolution = url.searchParams.get('resolution') || '1';
      const from = parseInt(url.searchParams.get('from') || '0', 10);
      const to = parseInt(url.searchParams.get('to') || String(Math.floor(Date.now()/1000)), 10);

      const ySymbol = toYahooSymbol(symbol);
      const interval = toYahooInterval(resolution);

      let result;
      try {
        result = await yahooFinance.chart(ySymbol, {
          period1: new Date(from * 1000),
          period2: new Date(to * 1000),
          interval,
        });
      } catch (e) {
        return jsonResponse({ s: 'error', errmsg: String(e) });
      }

      const r = result?.quotes || [];
      if (!r.length) return jsonResponse({ s: 'no_data' });

      const t = [], o = [], h = [], l = [], c = [], v = [];
      for (const bar of r) {
        if (bar.open == null || bar.close == null) continue;
        t.push(Math.floor(new Date(bar.date).getTime() / 1000));
        o.push(bar.open);
        h.push(bar.high ?? bar.open);
        l.push(bar.low ?? bar.open);
        c.push(bar.close);
        v.push(bar.volume ?? 0);
      }
      if (!t.length) return jsonResponse({ s: 'no_data' });
      return jsonResponse({ s: 'ok', t, o, h, l, c, v });
    }

    return jsonResponse({ error: 'unknown action', action }, 400);
  } catch (err) {
    return jsonResponse({ s: 'error', errmsg: String(err) }, 500);
  }
}
