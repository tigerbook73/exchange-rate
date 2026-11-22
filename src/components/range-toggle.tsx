import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RANGE_LABELS, type RangeOption } from "@/lib/rate-view";

const RANGE_OPTIONS: RangeOption[] = ["1d", "7d", "30d", "90d", "180d", "365d"];

export function RangeToggle({
  value,
  onChange,
}: {
  value: RangeOption;
  onChange: (value: RangeOption) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({
    left: false,
    right: false,
    overflow: false,
  });

  useEffect(() => {
    const element = viewport.current;
    const inner = content.current;
    const outer = group.current;
    if (!element || !inner || !outer) return;
    const update = () => {
      const overflow = inner.scrollWidth > outer.clientWidth + 1;
      const left = element.scrollLeft > 1;
      const right =
        element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((previous) =>
        previous.left === left &&
        previous.right === right &&
        previous.overflow === overflow
          ? previous
          : { left, right, overflow },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(inner);
    observer.observe(outer);
    element.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, []);

  function scroll(direction: number) {
    const element = viewport.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * 0.75,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  return (
    <div
      ref={group}
      className={`grid min-w-0 items-center ${edges.overflow ? "grid-cols-[2rem_minmax(0,1fr)_2rem] gap-1" : "grid-cols-1"}`}
      role="group"
      aria-label="时间范围"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="向左移动时间范围"
        aria-hidden={!edges.left}
        tabIndex={edges.left ? 0 : -1}
        disabled={!edges.left}
        className={!edges.overflow ? "hidden" : edges.left ? "" : "invisible"}
        onClick={() => scroll(-1)}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div
        ref={viewport}
        className="min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          ref={content}
          className="flex w-max min-w-full items-center justify-center gap-1 py-1"
        >
          {RANGE_OPTIONS.map((option) => (
            <Button
              className="shrink-0 text-base"
              key={option}
              type="button"
              size="lg"
              variant={value === option ? "default" : "outline"}
              aria-pressed={value === option}
              onClick={() => onChange(option)}
            >
              {RANGE_LABELS[option]}
            </Button>
          ))}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="向右移动时间范围"
        aria-hidden={!edges.right}
        tabIndex={edges.right ? 0 : -1}
        disabled={!edges.right}
        className={!edges.overflow ? "hidden" : edges.right ? "" : "invisible"}
        onClick={() => scroll(1)}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
