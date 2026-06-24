/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Reusable history line chart with a period selector — used by the database, SNMP
 * and ping panels so every metric history offers the same short/long/custom windows.
 * Presentational: the parent fetches per the selected period query and maps points.
 */
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PeriodSelector } from "@/components/PeriodSelector";

export interface ChartLine {
  key: string;
  label: string;
  color: string;
}

export function MetricChart({
  title, data, lines, period, onPeriod, unit, height = 180,
}: {
  title: string;
  data: Array<Record<string, number> & { t: number }>;
  lines: ChartLine[];
  period: string;
  onPeriod: (q: string) => void;
  unit?: string;
  height?: number;
}) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[0.65rem] uppercase tracking-wide text-slate-500">{title}</span>
        <PeriodSelector value={period} onChange={onPeriod} />
      </div>
      {data.length < 2 ? (
        <div className="py-6 text-xs text-slate-500">Not enough history in this window yet.</div>
      ) : (
        <div style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232c38" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tickFormatter={(t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                tick={{ fill: "#8a9cb0", fontSize: 10 }}
                minTickGap={48}
              />
              <YAxis unit={unit} tick={{ fill: "#8a9cb0", fontSize: 10 }} width={40} />
              <Tooltip
                contentStyle={{ background: "#12161c", border: "1px solid #232c38", borderRadius: 8, color: "#eef3f9", fontSize: 12 }}
                labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
              />
              {lines.map((l) => (
                <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={1.5} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
