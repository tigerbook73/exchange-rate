"use client";

import {
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import type { ChartPoint } from "@/lib/rate-view";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
);

// Reused from the app's existing shadcn theme tokens (see globals.css), plus
// one deliberate accent hue for the data line — validated against both
// surfaces with the dataviz skill's palette script (#2563eb on #ffffff,
// #3b82f6 on #0a0a0a both pass contrast + lightness-band checks).
const PALETTE = {
  light: {
    line: "#2563eb",
    grid: "oklch(0.922 0 0)",
    text: "oklch(0.556 0 0)",
  },
  dark: { line: "#3b82f6", grid: "oklch(0.269 0 0)", text: "oklch(0.708 0 0)" },
};

export function RateChart({ points }: { points: ChartPoint[] }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-mount flag, cannot be derived from props/state
    setMounted(true);
  }, []);

  const colors =
    mounted && resolvedTheme === "dark" ? PALETTE.dark : PALETTE.light;

  const data = {
    labels: points.map((p) => p.date.slice(5)), // "MM-DD"
    datasets: [
      {
        data: points.map((p) => p.huiSell),
        borderColor: colors.line,
        backgroundColor: colors.line,
        borderWidth: 2,
        spanGaps: false,
        pointRadius: points.map((p) =>
          p.huiSell === null ? 0 : p.isCarriedForward ? 5 : 3,
        ),
        pointBackgroundColor: points.map((p) =>
          p.isCarriedForward ? "transparent" : colors.line,
        ),
        pointBorderColor: colors.line,
        pointBorderWidth: points.map((p) => (p.isCarriedForward ? 2 : 0)),
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { right: 8, left: 4, top: 8, bottom: 4 } },
    plugins: {
      tooltip: {
        callbacks: {
          afterLabel: (item) => {
            const point = points[item.dataIndex];
            return point?.isCarriedForward
              ? "该日期未更新，沿用前一日数据"
              : "";
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: colors.grid },
        ticks: { color: colors.text, maxRotation: 0 },
      },
      y: { grid: { color: colors.grid }, ticks: { color: colors.text } },
    },
  };

  const hasCarriedForwardPoint = points.some((p) => p.isCarriedForward);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <Line data={data} options={options} />
      </div>
      {hasCarriedForwardPoint ? (
        <p className="mt-1 text-right text-xs text-muted-foreground">
          ○ 空心点：数据未更新，沿用前一日
        </p>
      ) : null}
    </div>
  );
}
