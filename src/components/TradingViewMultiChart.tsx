'use client';
import { useEffect, useRef } from 'react';

export default function TradingViewMultiChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/charting_library/charting_library.js';
    script.async = true;
    script.onload = () => {
      const TV = (window as any).TradingView;
      const Datafeeds = (window as any).Datafeeds;
      if (!TV || !Datafeeds) { console.error('TV globals missing'); return; }

      widgetRef.current = new TV.widget({
        container: containerRef.current,
        library_path: '/charting_library/',
        layout: '4',
        symbol: 'BINANCE:BTCUSDT',
        interval: '1',
        locale: 'en',
        datafeed: new Datafeeds.UDFCompatibleDatafeed('https://demo-feed-data.tradingview.com'),
      });

      widgetRef.current.onChartReady(() => {
        const c1 = widgetRef.current.chart(0);
        const c2 = widgetRef.current.chart(1);
        const c3 = widgetRef.current.chart(2);
        const c4 = widgetRef.current.chart(3);
        c1.setResolution('1');  c1.createStudy('Moving Average', false, false, { length: 50 });
        c2.setResolution('3');  c2.createStudy('Bollinger Bands', true, false, { in_0: 20, in_1: 2 });
        c3.setResolution('15'); c3.createStudy('Relative Strength Index', false, false, { in_0: 14 });
        c4.setResolution('30'); c4.createStudy('Volume', false, false);
      });
    };
    document.head.appendChild(script);
    return () => {
      if (widgetRef.current) widgetRef.current.remove();
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100vh' }} />;
}
