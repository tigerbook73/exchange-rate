import { addDays, getBeijingDateString } from "./date";
import {
  FIXED_MS,
  MINUTE_MS,
  type CollectionState,
  type IntradayPoint,
  type QuoteSample,
} from "../contracts/server-types";

export function minuteOf(time: number): number {
  return Math.floor(time / MINUTE_MS) * MINUTE_MS;
}

export function retainedDate(now: number): string {
  return addDays(getBeijingDateString(new Date(now)), -2);
}

export function dayStart(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`);
}

function pointAt(
  minute: number,
  sample: QuoteSample | null,
  kind: IntradayPoint["kind"],
): IntradayPoint {
  const eligible =
    sample && sample.minute <= minute && minute - sample.minute <= FIXED_MS
      ? sample
      : null;
  return {
    minute,
    kind,
    priceUnits: eligible?.priceUnits ?? null,
    sourceMinute: eligible?.minute ?? null,
    sourceRequestedAt: eligible?.requestedAt ?? null,
    publishedAt: eligible?.publishedAt ?? null,
    isFallback: Boolean(eligible && eligible.minute !== minute),
  };
}

/** A request's start minute, never its scheduled time or completion time. */
export function advanceCollection(
  previous: CollectionState,
  requestedAt: number,
  sample: QuoteSample | null,
  error: string | null,
) {
  const minute = minuteOf(requestedAt);
  if (
    previous.lastAttemptMinute !== null &&
    minute <= previous.lastAttemptMinute
  )
    return null;
  const state = structuredClone(previous);
  state.startedAt ??= new Date(requestedAt).toISOString();
  // Reject time-travelling upstream quotes without overwriting our trusted latest.
  if (
    sample &&
    state.lastSuccess &&
    sample.publishedAt < state.lastSuccess.publishedAt
  ) {
    sample = null;
    error = "source-time-regressed";
  }
  const fixed: IntradayPoint[] = [];
  const end = Math.floor(minute / FIXED_MS) * FIXED_MS;
  const first =
    state.lastFinalized === null
      ? Math.ceil(minute / FIXED_MS) * FIXED_MS
      : state.lastFinalized + FIXED_MS;
  const start = Math.max(first, dayStart(retainedDate(requestedAt)));
  for (let boundary = start; boundary <= end; boundary += FIXED_MS) {
    // Finalize missing boundaries BEFORE replacing the last real observation.
    fixed.push(
      pointAt(
        boundary,
        boundary === minute && sample ? sample : state.lastSuccess,
        "fixed",
      ),
    );
  }
  state.lastFinalized = end;
  state.lastAttemptMinute = minute;
  state.lastAttemptAt = new Date(requestedAt).toISOString();
  state.lastError = sample ? null : (error ?? "collection-failed");
  state.consecutiveFailures = sample ? 0 : state.consecutiveFailures + 1;
  if (sample) {
    state.lastSuccess = sample;
    state.lastCheckedAt = sample.receivedAt;
    state.live = minute > end ? pointAt(minute, sample, "live") : null;
  }
  if (
    state.live &&
    (state.live.minute <= end ||
      minute - state.live.minute > FIXED_MS ||
      getBeijingDateString(new Date(state.live.minute)) !==
        getBeijingDateString(new Date(minute)))
  ) {
    state.live = null;
  }
  return { state, fixed, accepted: sample };
}
