'use client';
import { useEffect, useRef, useState } from 'react';

const SYMBOLS = [
  { symbol: 'FX_IDC:USDJPY', interval: '1',  indicator: 'Moving Average',     overlay: false, inputs: { length: 50 } },
  { symbol: 'BINANCE:BTCUSDT', interval: '3',  indicator: 'Bollinger Bands',   overlay: true,  inputs: { in_0: 20, in_1: 2 } },
  { symbol: 'FX_IDC:EURUSD', interval: '15', indicator: 'Relative Strength Index', overlay: false, inputs: { in_0: 14 } },
  { symbol: 'BINANCE:ETHUSDT', interval: '30', indicator: 'Volume',            overlay: false, inputs: {} },
];

export default function TradingViewMultiChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load: ${src}`));
      document.head.appendChild(s);
    });

    (async () => {
      try {
        await loadScript('/charting_library/charting_library.js');
        await loadScript('/datafeeds/udf/dist/bundle.js');
        if (cancelled) return;

        const TV = (window as any).TradingView;
        const Datafeeds = (window as any).Datafeeds;
        if (!TV) { setError('TradingView global missing'); return; }
        if (!Datafeeds) { setError('Datafeeds global missing'); return; }
        if (!containerRef.current) return;

        widgetRef.current = new TV.widget({
          container: containerRef.current,
          library_path: '/charting_library/',
          layout: '4',
          symbol: SYMBOLS[0].symbol,
          interval: SYMBOLS[0].interval,
          locale: 'en',
          datafeed: new Datafeeds.UDFCompatibleDatafeed('https://demo-feed-data.tradingview.com'),
          disabled_features: ['use_localstorage_for_settings'],
        });

        widgetRef.current.onChartReady(() => {
          try {
            // Configure each chart pane
            SYMBOLS.forEach((cfg, i) => {
              const chart = widgetRef.current.chart(i);
              if (!chart) return;

              // Set symbol (all except first, since first is set at widget init)
              if (i > 0) chart.setSymbol(cfg.symbol, () => {});
              chart.setResolution(cfg.interval);

              // Add indicator
              if (cfg.indicator === 'Volume') {
                chart.createStudy('Volume', false, false);
              } else if (cfg.indicator === 'Moving Average') {
                chart.createStudy('Moving Average', cfg.overlay, false, cfg.inputs);
              } else if (cfg.indicator === 'Bollinger Bands') {
                chart.createStudy('Bollinger Bands', cfg.overlay, false, cfg.inputs);
              } else if (cfg.indicator === 'Relative Strength Index') {
                chart.createStudy('Relative Strength Index', cfg.overlay, false, cfg.inputs);
              }
            });
          } catch (e: any) {
            console.error('Indicator setup failed:', e);
          }
        });
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (widgetRef.current) { try { widgetRef.current.remove(); } catch {} }
    };
  }, []);

  if (error) {
    return (
      <div style={{ padding: 24, color: '#ff6b6b', background: '#0e1117', fontFamily: 'monospace', minHeight: '100vh' }}>
        <h2>Chart load error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#d1d4dc' }}>{error}</pre>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />;
}
