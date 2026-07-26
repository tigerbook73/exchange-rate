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
import { useEffect, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import type { ChartPoint } from "@/lib/rate-view";

// Draws a vertical reference line through the currently hovered/touched
// data point, so a finger dragging across the chart gets a visible
// crosshair alongside the tooltip.
const crosshairPlugin: Plugin<"line"> = {
  id: "crosshair",
  afterDraw: (chart) => {
    const active = chart.getActiveElements()[0];
    if (!active) {
      return;
    }
    const { ctx, chartArea } = chart;
    const x = active.element.x;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = chart.options.plugins?.crosshair?.color ?? "#8888";
    ctx.stroke();
    ctx.restore();
  },
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  crosshairPlugin,
);

declare module "chart.js" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- must match chart.js's own generic signature to merge
  interface PluginOptionsByType<TType> {
    crosshair?: { color?: string };
  }
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
  },
  dark: { line: "#3b82f6", grid: "oklch(0.269 0 0)", text: "oklch(0.708 0 0)" },
};

export function RateChart({ points }: { points: ChartPoint[] }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const chartRef = useRef<ChartJS<"line"> | null>(null);
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
  // stay legible, so only the line itself is shown; the carried-forward
  // "hollow circle" marking still works via tooltip at any range.
  const showMarkers = points.length <= 30;

  const data = {
    labels: points.map((p) => p.date.slice(5)), // "MM-DD"
    datasets: [
      {
        data: points.map((p) => p.huiSell),
        borderColor: colors.line,
        backgroundColor: colors.line,
        borderWidth: 2,
        spanGaps: false,
        pointRadius: points.map((p) => {
          if (p.huiSell === null || !showMarkers) return 0;
          return p.isCarriedForward ? 5 : 3;
        }),
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
    interaction: { mode: "index", intersect: false },
    hover: { mode: "index", intersect: false },
    plugins: {
      crosshair: { color: colors.grid },
      tooltip: {
        mode: "index",
        intersect: false,
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

  return (
    <div className="relative min-h-0 flex-1">
      <Line ref={chartRef} data={data} options={options} />
    </div>
  );
}
