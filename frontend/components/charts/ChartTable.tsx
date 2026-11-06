/**
 * The text equivalent behind every chart.
 *
 * A drawing is never the only record: screen readers, print and a copied
 * screenshot all get the same numbers the sighted reader sees.
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
  const [headA, headB] = headers;
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{headA}</th>
          <th scope="col" className="text-right">
            {headB}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td className="num text-right">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
