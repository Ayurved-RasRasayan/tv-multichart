'use client';
import { useEffect, useRef, useState } from 'react';

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
        if (!TV) { setError('TradingView global missing after charting_library.js'); return; }
        if (!Datafeeds) { setError('Datafeeds global missing after bundle.js'); return; }
        if (!containerRef.current) return;

        widgetRef.current = new TV.widget({
          container: containerRef.current,
          library_path: '/charting_library/',
          layout: '4',
          symbol: 'BINANCE:BTCUSDT',
          interval: '1',
          locale: 'en',
          datafeed: new Datafeeds.UDFCompatibleDatafeed('https://demo-feed-data.tradingview.com'),
          disabled_features: ['use_localstorage_for_settings'],
        });

        widgetRef.current.onChartReady(() => {
          try {
            const c1 = widgetRef.current.chart(0);
            const c2 = widgetRef.current.chart(1);
            const c3 = widgetRef.current.chart(2);
            const c4 = widgetRef.current.chart(3);
            c1.setResolution('1');  c1.createStudy('Moving Average', false, false, { length: 50 });
            c2.setResolution('3');  c2.createStudy('Bollinger Bands', true, false, { in_0: 20, in_1: 2 });
            c3.setResolution('15'); c3.createStudy('Relative Strength Index', false, false, { in_0: 14 });
            c4.setResolution('30'); c4.createStudy('Volume', false, false);
          } catch (e: any) { console.error('Indicator setup failed:', e); }
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
      <div style={{ padding: 24, color: '#ff6b6b', background: '#0e1117', fontFamily: 'monospace', minHeight: '100vh', boxSizing: 'border-box' }}>
        <h2>Chart load error</h2>
        <pre style={{ whiteSpace: 'pre-wrap', color: '#d1d4dc' }}>{error}</pre>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />;
}
