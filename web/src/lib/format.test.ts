import { describe, expect, it } from "vitest";
import { formatCost, formatMs } from "./format";

describe("formatMs", () => {
  it("switches to seconds from 1000 ms and shows a missing value as a dash", () => {
    expect(formatMs(4.2)).toBe("4.2 ms");
    expect(formatMs(233.4)).toBe("233 ms");
    expect(formatMs(1500)).toBe("1.50 s");
    expect(formatMs(null)).toBe("-");
  });
});

describe("formatCost", () => {
  it("never shows a misleading zero for tiny costs", () => {
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.00001)).toBe("<$0.0001");
    expect(formatCost(0.01234)).toBe("$0.0123");
  });
});
