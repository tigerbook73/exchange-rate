"use client";

import { useEffect, useRef, useState } from "react";

const TRIGGER_DISTANCE_PX = 70;
const MAX_PULL_PX = 110;
// Finger movement below this threshold is ignored so a light touch/scroll
// jitter at the top of the page doesn't reveal the pull indicator.
const DEAD_ZONE_PX = 24;
// Damping applied after the dead zone so the indicator follows the finger
// more slowly, requiring a longer pull to reach TRIGGER_DISTANCE_PX.
const PULL_RESISTANCE = 0.5;

/**
 * Minimal touch-based pull-to-refresh: only engages when the page is
 * already scrolled to the top, so it never fights normal scrolling.
 * Returns the current pull distance (for a visual indicator) and whether
 * a refresh is in progress.
 */
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    function onTouchStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (window.scrollY === 0 && touch) {
        startY.current = touch.clientY;
      }
    }

    function onTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (startY.current === null || !touch) {
        return;
      }
      const delta = touch.clientY - startY.current;
      if (delta <= DEAD_ZONE_PX) {
        setPullDistance(0);
        return;
      }
      const dampened = (delta - DEAD_ZONE_PX) * PULL_RESISTANCE;
      setPullDistance(Math.min(dampened, MAX_PULL_PX));
    }

    async function onTouchEnd() {
      if (startY.current === null) {
        return;
      }
      startY.current = null;
      setPullDistance((distance) => {
        if (distance >= TRIGGER_DISTANCE_PX) {
          setIsRefreshing(true);
          void onRefresh().finally(() => setIsRefreshing(false));
        }
        return 0;
      });
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [onRefresh]);

  return { pullDistance, isRefreshing, triggerDistance: TRIGGER_DISTANCE_PX };
}
