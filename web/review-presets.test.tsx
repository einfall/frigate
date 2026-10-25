import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getReviewPresetRange } from "./src/utils/reviewDatePreset";
import ReviewDatePresets from "./src/components/filter/ReviewDatePresets";

vi.mock("swr", () => ({ default: () => ({ data: { ui: { timezone: "Europe/Berlin" } } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const iso = (time?: number) => new Date(time! * 1000).toISOString();
const now = new Date("2026-10-24T17:00:00Z");

describe("Berlin review periods", () => {
  it.each([
    ["currentWeek", "2026-10-18T22:00:00.000Z", undefined],
    ["lastWeek", "2026-10-11T22:00:00.000Z", "2026-10-18T22:00:00.000Z"],
    ["currentMonth", "2026-09-30T22:00:00.000Z", undefined],
    ["lastMonth", "2026-08-31T22:00:00.000Z", "2026-09-30T22:00:00.000Z"],
  ] as const)("%s has exact calendar bounds", (preset, start, end) => {
    const range = getReviewPresetRange(preset, now);
    expect(iso(range.after)).toBe(start);
    expect(range.before == undefined ? undefined : iso(range.before)).toBe(end);
  });

  it.each([
    ["2026-03-30T10:00:00Z", 167, "2026-03-22T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
    ["2026-10-26T10:00:00Z", 169, "2026-10-18T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
  ])("handles DST in the previous week from %s", (date, hours, start, end) => {
    const range = getReviewPresetRange("lastWeek", new Date(date));
    expect(iso(range.after)).toBe(start);
    expect(iso(range.before)).toBe(end);
    expect((range.before! - range.after!) / 3600).toBe(hours);
  });

  it("handles January's previous month and leap February", () => {
    const december = getReviewPresetRange("lastMonth", new Date("2026-01-06T12:00:00Z"));
    expect(iso(december.after)).toBe("2025-11-30T23:00:00.000Z");
    expect(iso(december.before)).toBe("2025-12-31T23:00:00.000Z");
    const february = getReviewPresetRange("lastMonth", new Date("2024-03-03T12:00:00Z"));
    expect((february.before! - february.after!) / 86400).toBe(29);
  });

  it("uses Monday in Berlin even when UTC is still Sunday", () => {
    const range = getReviewPresetRange("currentWeek", new Date("2026-10-25T23:30:00Z"));
    expect(iso(range.after)).toBe("2026-10-25T23:00:00.000Z");
  });

  it("resets to the existing rolling 24-hour view", () => {
    expect(getReviewPresetRange(undefined, now)).toEqual({ after: undefined, before: undefined });
  });
});

describe("preset controls", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("selects all four periods while retaining camera and label filters", () => {
    const update = vi.fn();
    const close = vi.fn();
    act(() => root.render(<ReviewDatePresets filter={{ cameras: ["front_door"], labels: ["person"] }} onUpdateFilter={update} onSelect={close} />));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons).toHaveLength(5);
    for (const [index, preset] of ["currentWeek", "lastWeek", "currentMonth", "lastMonth"].entries()) {
      act(() => buttons[index + 1].click());
      expect(update).toHaveBeenLastCalledWith({
        cameras: ["front_door"], labels: ["person"], datePreset: preset,
        ...getReviewPresetRange(preset as Parameters<typeof getReviewPresetRange>[0], now),
      });
    }
    expect(close).toHaveBeenCalledTimes(4);
  });

  it("marks the chosen preset and resets both bounds and preset", () => {
    const update = vi.fn();
    act(() => root.render(<ReviewDatePresets filter={{ after: 10, before: 20, datePreset: "lastMonth", zones: ["door"] }} onUpdateFilter={update} />));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons[4].getAttribute("aria-pressed")).toBe("true");
    act(() => buttons[0].click());
    expect(update).toHaveBeenCalledWith({ after: undefined, before: undefined, datePreset: undefined, zones: ["door"] });
  });
});
