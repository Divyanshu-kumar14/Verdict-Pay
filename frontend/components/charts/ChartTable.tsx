/**
 * Visually hidden data table behind every chart.
 *
 * Colour is never the only signal and a canvas-free SVG still needs a text
 * equivalent: screen readers get the same numbers the sighted reader sees.
 */

export function ChartTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: [string, string];
  rows: Array<[string, string]>;
}): React.JSX.Element {
  const headA = headers[0];
  const headB = headers[1];
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{headA}</th>
          <th scope="col">{headB}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
