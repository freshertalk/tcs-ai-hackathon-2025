import { notAutofill } from "./Watchlist";

test("the stock search drops a saved email the browser pours in, and keeps every real search", () => {
  expect(notAutofill("someone@example.com", "")).toBe(""); // a browser's sign-in fill, all at once
  expect(notAutofill("SBIN", "SBI")).toBe("SBIN");
  expect(notAutofill("M&M", "M&")).toBe("M&M");
  expect(notAutofill("", "SBIN")).toBe("");
  expect(notAutofill("BAJAJ-AUTO", "")).toBe("BAJAJ-AUTO"); // a paste of a symbol is fine
});
