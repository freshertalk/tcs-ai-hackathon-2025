import React from "react";
import fs from "fs";
import path from "path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DialogProvider, useDialog } from "./DialogProvider";

function Asker({ req, onAnswer }) {
  const ask = useDialog();
  return (
    <button type="button" onClick={async () => onAnswer(await ask(req))}>
      ask
    </button>
  );
}

const open = (req) => {
  const answers = [];
  render(
    <DialogProvider>
      <Asker req={req} onAnswer={(a) => answers.push(a)} />
    </DialogProvider>
  );
  fireEvent.click(screen.getByText("ask"));
  return answers;
};

test("the site's own dialog: title, message, both choices, and the answer comes back", async () => {
  const answers = open({ tone: "danger", title: "Clear the paper record?", body: "This removes every paper trade.", confirmText: "Clear the record", cancelText: "Keep it" });
  expect(screen.getByRole("alertdialog", { name: "Clear the paper record?" })).toBeTruthy();
  expect(screen.getByText("This removes every paper trade.")).toBeTruthy();
  // for anything that removes something, the safe choice holds the focus
  expect(document.activeElement).toBe(screen.getByText("Keep it"));
  await act(async () => fireEvent.click(screen.getByText("Clear the record")));
  expect(answers).toEqual([true]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("Escape and a click outside both mean no", async () => {
  const answers = open({ title: "Continue?", body: "x" });
  await act(async () => fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" }));
  expect(answers).toEqual([false]);
  fireEvent.click(screen.getByText("ask"));
  await act(async () => fireEvent.mouseDown(document.querySelector(".vd-overlay")));
  expect(answers).toEqual([false, false]);
});

test("no browser popups anywhere in the site: every question goes through the site's dialog", () => {
  const found = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.jsx?$/.test(f) && !/\.test\.js$/.test(f) && !p.endsWith(path.join("dialog", "DialogProvider.jsx"))) {
        if (/window\.(confirm|alert|prompt)\s*\(/.test(fs.readFileSync(p, "utf8"))) found.push(path.relative(process.cwd(), p));
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  expect(found).toEqual([]);
});
