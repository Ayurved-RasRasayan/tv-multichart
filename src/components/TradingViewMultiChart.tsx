'use client';
import { useEffect, useRef, useState } from 'react';

const SYMBOL = 'FX_IDC:USDJPY';

const CHARTS = [
  { interval: '1',  study: 'Moving Average',           overlay: false, inputs: { length: 50 } },
  { interval: '3',  study: 'Bollinger Bands',          overlay: true,  inputs: { in_0: 20, in_1: 2 } },
  { interval: '15', study: 'Relative Strength Index',  overlay: false, inputs: { in_0: 14 } },
  { interval: '30', study: 'Volume',                   overlay: false, inputs: {} },
];

function SingleChart({ cfg, index }: { cfg: typeof CHARTS[number]; index: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      for (let i = 0; i < 100 && !cancelled; i++) {
        const w = window as any;
        if (w.TradingView && w.Datafeeds) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (cancelled) return;

      const TV = (window as any).TradingView;
      const Datafeeds = (window as any).Datafeeds;
      if (!TV)       { setErr('TradingView global missing'); return; }
      if (!Datafeeds){ setErr('Datafeeds global missing'); return; }
      if (!containerRef.current) return;

      const datafeed = new Datafeeds.UDFCompatibleDatafeed(
        `${window.location.origin}/api/udf`,
        10000
      );

      widgetRef.current = new TV.widget({
        container: containerRef.current,
        library_path: '/charting_library/',
        symbol: SYMBOL,
        interval: cfg.interval,
        locale: 'en',
        datafeed,
        disabled_features: [
          'use_localstorage_for_settings',
          'header_symbol_search',
          'header_compare',
          'header_saveload',
          'header_undo_redo',
        ],
      });

      widgetRef.current.onChartReady(() => {
        if (cancelled) return;
        try {
          if (cfg.study === 'Volume') {
            widgetRef.current.chart().createStudy('Volume', false, false);
          } else {
            widgetRef.current.chart().createStudy(cfg.study, cfg.overlay, false, cfg.inputs);
          }
        } catch (e) {
          console.error(`Study error on chart ${index}:`, e);
        }
        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      if (widgetRef.current) { try { widgetRef.current.remove(); } catch {} }
    };
  }, [cfg, index]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', border: '1px solid #1e222d', background: '#0e1117', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: 6, left: 10, zIndex: 10,
        color: ready ? '#26a69a' : '#f0b90b',
        fontFamily: 'monospace', fontSize: 12,
        background: 'rgba(14,17,23,0.85)', padding: '3px 8px', borderRadius: 3,
        pointerEvents: 'none',
      }}>
        USDJPY  {cfg.interval}m  {cfg.study} {ready ? '' : ''}
      </div>
      {err && (
        <div style={{ padding: 16, color: '#ff6b6b', fontFamily: 'monospace', fontSize: 12 }}>
          {err}
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

export default function TradingViewMultiChart() {
  const [libsReady, setLibsReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const loadScript = (src: string) => new Promise<void>((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
      });

      try {
        await loadScript('/charting_library/charting_library.js');
        await loadScript('/datafeeds/udf/dist/bundle.js');
        setLibsReady(true);
      } catch (e: any) {
        setLoadErr(e.message || String(e));
      }
    })();
  }, []);

  if (loadErr) {
    return (
      <div style={{ padding: 24, color: '#ff6b6b', background: '#0e1117', fontFamily: 'monospace', minHeight: '100vh' }}>
        <h2>Library load error</h2>
        <pre>{loadErr}</pre>
      </div>
    );
  }

  if (!libsReady) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0e1117', color: '#d1d4dc', fontFamily: 'monospace' }}>
        Loading TradingView libraries
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gap: 3,
      width: '100vw',
      height: '100vh',
      background: '#0e1117',
      padding: 3,
      boxSizing: 'border-box',
      margin: 0,
    }}>
      {CHARTS.map((cfg, i) => (
        <SingleChart key={i} cfg={cfg} index={i} />
      ))}
    </div>
  );
}
