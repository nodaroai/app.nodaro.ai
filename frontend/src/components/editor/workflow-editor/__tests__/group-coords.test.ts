import { describe, expect, it } from "vitest";
import { computeOverlap, worldToLocal, localToWorld } from "../group-coords";

describe("computeOverlap", () => {
  it("returns 1 when node fully inside group", () => {
    expect(computeOverlap(
      { x: 10, y: 10, width: 50, height: 50 },
      { x: 0, y: 0, width: 200, height: 200 },
    )).toBe(1);
  });
  it("returns 0 when fully outside", () => {
    expect(computeOverlap(
      { x: 300, y: 300, width: 50, height: 50 },
      { x: 0, y: 0, width: 200, height: 200 },
    )).toBe(0);
  });
  it("returns ~0.5 when half overlapping", () => {
    expect(computeOverlap(
      { x: 150, y: 50, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    )).toBeCloseTo(0.5, 1);
  });
  it("hits exactly 0.7 at threshold", () => {
    // Node spans x=130..230, group spans x=0..200 → overlap width = 70
    // Node fully inside vertically → overlap area = 70*100 = 7000, node area = 10000
    expect(computeOverlap(
      { x: 130, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 200, height: 200 },
    )).toBeCloseTo(0.7, 2);
  });
});

describe("worldToLocal / localToWorld", () => {
  it("converts world→local correctly", () => {
    expect(worldToLocal({ x: 100, y: 200 }, { x: 30, y: 40 })).toEqual({ x: 70, y: 160 });
  });
  it("converts local→world correctly", () => {
    expect(localToWorld({ x: 70, y: 160 }, { x: 30, y: 40 })).toEqual({ x: 100, y: 200 });
  });
});
