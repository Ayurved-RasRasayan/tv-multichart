'use client';

import dynamic from 'next/dynamic';

const TradingViewMultiChart = dynamic(
  () => import('@/components/TradingViewMultiChart'),
  { ssr: false, loading: () => <div style={{ padding: 40, color: '#d1d4dc', background: '#0e1117', height: '100vh' }}>Loading charts</div> }
);

export default function Home() {
  return (
    <main style={{ margin: 0, padding: 0 }}>
      <TradingViewMultiChart />
    </main>
  );
}
