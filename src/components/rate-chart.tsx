"use client";

import {
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import type { ChartPoint } from "@/lib/domain/rate-view";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
);

// Fast Refresh can retain the old globally registered canvas plugin after
// switching to a local overlay plugin. Remove it from existing dev charts.
if (process.env.NODE_ENV === "development") {
  ChartJS.unregister({ id: "crosshair" });
}

// Reused from the app's existing shadcn theme tokens (see globals.css), plus
// one deliberate accent hue for the data line — validated against both
// surfaces with the dataviz skill's palette script (#2563eb on #ffffff,
// #3b82f6 on #0a0a0a both pass contrast + lightness-band checks).
const PALETTE = {
  light: {
    line: "#2563eb",
    grid: "oklch(0.922 0 0)",
    text: "oklch(0.556 0 0)",
    crosshair: "oklch(0.556 0 0 / 0.55)",
  },
  dark: {
    line: "#3b82f6",
    grid: "oklch(0.269 0 0)",
    text: "oklch(0.708 0 0)",
    crosshair: "oklch(0.828 0.189 84.429 / 0.45)", // Subdued amber-400.
  },
};

export function RateChart({
  points,
  emptyMessage = "该时段暂无已缓存数据",
}: {
  points: ChartPoint[];
  emptyMessage?: string;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const chartRef = useRef<ChartJS<"line"> | null>(null);
  const crosshairRef = useRef<HTMLDivElement | null>(null);
  const crosshairPlugin = useMemo<Plugin<"line">>(
    () => ({
      id: "single-crosshair",
      afterDraw(chart) {
        const line = crosshairRef.current;
        if (!line) return;
        const active = chart.getActiveElements()[0];
        if (!active) {
          line.style.display = "none";
          return;
        }
        // Move one overlay instead of adding strokes to the shared canvas.
        line.style.display = "block";
        line.style.transform = "none";
        line.style.left = `${Math.round(active.element.x) - 1}px`;
        line.style.top = `${chart.chartArea.top}px`;
        line.style.height = `${chart.chartArea.bottom - chart.chartArea.top}px`;
      },
    }),
    [],
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client-mount flag, cannot be derived from props/state
    setMounted(true);
  }, []);

  useEffect(() => {
    // On mobile, waking a backgrounded PWA sometimes leaves Chart.js's
    // ResizeObserver-driven canvas buffer stuck at a stale (much smaller)
    // size from before suspension, rendering the chart tiny in the
    // top-left corner. Forcing a resize once the page is visible again
    // fixes it without waiting for another layout-triggering resize event.
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      chartRef.current?.resize();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const colors =
    mounted && resolvedTheme === "dark" ? PALETTE.dark : PALETTE.light;

  // Beyond ~30 days there are too many points for individual markers to
  // stay legible, so only the line itself is shown. Source notes remain
  // available in the tooltip at every range.
  const showMarkers = points.length <= 30;

  const data = {
    labels: points.map((p) => p.label ?? p.date.slice(5)),
    datasets: [
      {
        data: points.map((p) => p.huiSell),
        borderColor: colors.line,
        backgroundColor: colors.line,
        borderWidth: 2,
        spanGaps: false,
        pointRadius: points.map((p) =>
          p.huiSell !== null && showMarkers && !p.isReference ? 3 : 0,
        ),
        pointHoverRadius: points.map((p) => (p.isReference ? 0 : 4)),
        pointBackgroundColor: colors.line,
        pointBorderColor: colors.line,
        pointBorderWidth: 0,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { right: 8, left: 4, top: 8, bottom: 4 } },
    interaction: { mode: "index", intersect: false },
    hover: { mode: "index", intersect: false },
    plugins: {
      tooltip: {
        mode: "index",
        intersect: false,
        callbacks: {
          afterLabel: (item) => {
            const point = points[item.dataIndex];
            return point?.note ?? "";
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

  return (
    <div className="relative min-h-0 flex-1">
      <Line
        className="absolute inset-0 h-full w-full"
        ref={chartRef}
        data={data}
        options={options}
        plugins={[crosshairPlugin]}
        role="img"
        aria-label="澳元购汇价走势图"
      />
      <div
        ref={crosshairRef}
        data-chart-crosshair=""
        aria-hidden="true"
        className="pointer-events-none absolute left-0 hidden w-0.5 transition-none"
        style={{ backgroundColor: colors.crosshair }}
      />
      {points.every((point) => point.huiSell === null) ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : null}
    </div>
  );
}
