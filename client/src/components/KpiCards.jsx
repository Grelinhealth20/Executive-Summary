import React from 'react';
import { money, moneyShort, int, pct } from '../format.js';

export default function KpiCards({ kpis }) {
  const collectedPctOfCharges = kpis.totalCharges ? (kpis.totalPayments / kpis.totalCharges) * 100 : 0;
  const osPctOfCharges = kpis.totalCharges ? (kpis.totalOutstanding / kpis.totalCharges) * 100 : 0;

  const cards = [
    {
      label: 'Total Charges', value: moneyShort(kpis.totalCharges), cls: 'navy',
      sub: 'Gross billed', title: money(kpis.totalCharges),
    },
    {
      label: 'Total Collected', value: moneyShort(kpis.totalPayments), cls: 'teal',
      sub: `${pct(collectedPctOfCharges)} of charges`, title: money(kpis.totalPayments),
    },
    {
      label: 'Outstanding A/R', value: moneyShort(kpis.totalOutstanding), cls: 'amber',
      sub: `${pct(osPctOfCharges)} of charges open`, title: money(kpis.totalOutstanding),
    },
    {
      label: 'Net Collection', value: pct(kpis.netCollectionRate), cls: 'green',
      sub: 'Collected of allowed',
    },
    {
      label: 'Gross Collection', value: pct(kpis.grossCollectionRate), cls: 'navy',
      sub: 'Collected of billed',
    },
    {
      label: 'Denial Rate', value: pct(kpis.denialRate), cls: 'red',
      sub: `${int(kpis.deniedClaims)} denied claims`,
    },
    {
      label: 'Total Claims', value: int(kpis.totalClaims), cls: 'teal',
      sub: `${int(kpis.paidClaims)} paid · ${int(kpis.zeroPayClaims)} unpaid`,
    },
    {
      label: 'Avg A/R Days', value: kpis.avgArDays == null ? 'N/A' : int(kpis.avgArDays), cls: 'amber',
      sub: 'Days sales outstanding',
    },
  ];

  return (
    <div className="scorecard">
      {cards.map((c) => (
        <div className={`stat ${c.cls}`} key={c.label} title={c.title || ''}>
          <div className="s-label">{c.label}</div>
          <div className="s-value">{c.value}</div>
          {c.sub && <div className="s-sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
