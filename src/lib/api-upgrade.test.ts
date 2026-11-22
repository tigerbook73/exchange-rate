import { describe, expect, it } from "vitest";
import {
  needsCacheReset,
  prepareApiUpgrade,
  readUpgradeTicket,
} from "./api-upgrade";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
describe("API upgrade handshake", () => {
  it("reloads once for a target protocol, not once per quote revision", () => {
    const cache = storage();
    expect(prepareApiUpgrade(2, cache, 1)).toBe(true);
    expect(prepareApiUpgrade(2, cache, 1)).toBe(false);
    expect(prepareApiUpgrade(1, cache, 1)).toBe(false);
    expect(readUpgradeTicket(cache)).toEqual({
      fromSchema: 1,
      targetSchema: 2,
    });
  });
  it("resets only after a compatible new client can fetch a fresh snapshot", () => {
    expect(needsCacheReset({ schema: 1 }, 1)).toBe(false);
    expect(needsCacheReset({ schema: 1 }, 2)).toBe(true);
    expect(needsCacheReset({ schema: 2 }, 2)).toBe(false);
    expect(needsCacheReset(undefined, 1)).toBe(true);
  });
  it("does not create reload loops when session storage cannot persist", () => {
    expect(
      prepareApiUpgrade(
        2,
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("blocked");
          },
        },
        1,
      ),
    ).toBe(false);
  });
});
