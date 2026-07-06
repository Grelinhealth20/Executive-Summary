import React from 'react';

/**
 * columns: [{ header, key, align, render, footer }]
 * rows: array of objects
 * totals: optional object for a footer row (values keyed by column.key)
 */
export default function DataTable({ columns, rows, totals }) {
  if (!rows || rows.length === 0) {
    return <p className="muted-note">No data available for this section.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                  {c.render ? c.render(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {columns.map((c, idx) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                  {idx === 0 ? 'TOTAL' : c.footer ? c.footer(totals[c.key], totals) : totals[c.key] ?? ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
