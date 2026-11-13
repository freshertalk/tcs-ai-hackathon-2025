import { act, renderHook } from "@testing-library/react";
import { BOTTOM_NAV, PHONE, SPLIT, useMedia } from "./useMedia";

/** A stand-in for window.matchMedia whose answer a test can flip. */
function fakeMedia(initial) {
  const lists = new Map();
  window.matchMedia = (query) => {
    if (!lists.has(query)) {
      const listeners = new Set();
      lists.set(query, {
        matches: Boolean(initial[query]),
        media: query,
        addEventListener: (_, fn) => listeners.add(fn),
        removeEventListener: (_, fn) => listeners.delete(fn),
        listeners,
      });
    }
    return lists.get(query);
  };
  return {
    set(query, on) {
      const l = lists.get(query);
      l.matches = on;
      l.listeners.forEach((fn) => fn({ matches: on }));
    },
    count: (query) => (lists.get(query) ? lists.get(query).listeners.size : 0),
  };
}

afterEach(() => {
  delete window.matchMedia;
});

test("the three screen kinds are plain width rules that nest sensibly", () => {
  expect(PHONE).toBe("(max-width: 760px)");
  expect(BOTTOM_NAV).toBe("(max-width: 1100px)");
  expect(SPLIT).toBe("(min-width: 1600px)");
  const max = (q) => Number(/max-width: (\d+)px/.exec(q)[1]);
  expect(max(PHONE)).toBeLessThan(max(BOTTOM_NAV)); // every phone also gets the bottom bar
  expect(Number(/min-width: (\d+)px/.exec(SPLIT)[1])).toBeGreaterThan(max(BOTTOM_NAV)); // never both at once
});

test("a part of the page follows the screen as it changes, and stops listening when it goes", () => {
  const media = fakeMedia({ [PHONE]: true });
  const { result, unmount } = renderHook(() => useMedia(PHONE));
  expect(result.current).toBe(true);
  act(() => media.set(PHONE, false)); // the phone is turned on its side
  expect(result.current).toBe(false);
  act(() => media.set(PHONE, true));
  expect(result.current).toBe(true);
  expect(media.count(PHONE)).toBe(1);
  unmount();
  expect(media.count(PHONE)).toBe(0);
});

test("where the browser cannot say, the given fallback is used", () => {
  expect(typeof window.matchMedia).toBe("undefined");
  expect(renderHook(() => useMedia(SPLIT)).result.current).toBe(false);
  expect(renderHook(() => useMedia(SPLIT, true)).result.current).toBe(true);
});
