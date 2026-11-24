import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import OtherLedger, { importSaid } from "./OtherLedger";
import { api } from "../../api";

jest.mock("../../api", () => ({ api: jest.fn() }));
jest.mock("../../dialog/DialogProvider", () => ({ useDialog: () => () => Promise.resolve(true) }));
jest.mock("../../DatePicker", () => ({ DateField: ({ value, onChange }) => <input aria-label="Date of the entry" value={value} onChange={(e) => onChange(e.target.value)} /> }));

const KINDS = { dp: "DP charges", amc: "Annual maintenance (AMC)", other: "Other" };
const other = {
  count: 3,
  total: 830.5,
  credits: 1200.5,
  debits: -370,
  kinds: KINDS,
  entries: [
    { id: "a", date: "2026-04-05", amount: -15.34, kind: "dp", note: "DP charges for Q-1", source: "console", covered: true },
    { id: "b", date: "2026-04-10", amount: -354, kind: "amc", note: "AMC", source: "manual" },
    { id: "c", date: "2026-04-12", amount: 1200.5, kind: "other", note: "Dividend", source: "console" },
  ],
};

test("the totals, every entry newest first, and a DP charge already in the charges listed but not counted", () => {
  const { container } = render(<OtherLedger other={other} label="This FY" />);
  expect([...container.querySelectorAll(".ol-kpis dd")].map((d) => d.textContent)).toEqual(["+₹1,200.50", "−₹370.00", "+₹830.50"]);
  const rows = [...container.querySelectorAll(".ol-table tbody tr")];
  expect(rows[0].textContent).toMatch(/12 Apr 2026.*Dividend/);
  expect(rows[2].className).toBe("is-covered");
  expect(rows[2].textContent).toMatch(/already in charges/);
});

test("nothing recorded: said, with the way to fix it", () => {
  render(<OtherLedger other={{ count: 0, total: 0, credits: 0, debits: 0, entries: [], kinds: KINDS }} label="This FY" />);
  expect(screen.getByText(/Nothing recorded for This FY/)).toBeTruthy();
});

test("a debit is sent negative, a credit positive; a non-number is refused before it is sent", async () => {
  api.mockResolvedValue({});
  const onChanged = jest.fn();
  const { container } = render(<OtherLedger other={{ ...other, entries: [], count: 0 }} onChanged={onChanged} />);
  const amount = container.querySelector('.ol-form input[placeholder^="e.g. 354"]');
  fireEvent.change(amount, { target: { value: "abc" } });
  fireEvent.click(screen.getByRole("button", { name: /Add entry/ }));
  expect(api).not.toHaveBeenCalled();
  expect(screen.getByText(/plain number/)).toBeTruthy();
  fireEvent.change(amount, { target: { value: "354" } });
  fireEvent.click(screen.getByRole("button", { name: /Add entry/ }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(api.mock.calls[0][0]).toBe("/api/admin/trading/journal/other");
  expect(api.mock.calls[0][1].body.amount).toBe(-354);
  fireEvent.change(container.querySelectorAll(".ol-form select")[1], { target: { value: "credit" } });
  fireEvent.change(container.querySelector('.ol-form input[placeholder^="e.g. 354"]'), { target: { value: "354" } });
  fireEvent.click(screen.getByRole("button", { name: /Add entry/ }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(api.mock.calls[1][1].body.amount).toBe(354);
});

test("removing asks first, then deletes that entry", async () => {
  api.mockResolvedValue({});
  const onChanged = jest.fn();
  render(<OtherLedger other={other} onChanged={onChanged} />);
  fireEvent.click(screen.getAllByRole("button", { name: /Remove the entry of 10 Apr 2026/ })[0]);
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith("/api/admin/trading/journal/other/b", { method: "DELETE" });
});

test("what a ledger read says: new entries, and what was left out as not “other”", () => {
  expect(importSaid({ name: "l.csv", added: 4, read: 4, left: { "trade settlements": 9, "fund transfers": 2 } })).toBe("l.csv: 4 new entries added. Left out, as they are not “other”: 9 trade settlements, 2 fund transfers.");
  expect(importSaid({ added: 0, read: 4, left: {} })).toMatch(/already here/);
  expect(importSaid({ added: 1, read: 1, left: {} })).toBe("1 new entry added.");
});
