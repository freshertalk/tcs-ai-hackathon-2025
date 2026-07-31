import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the author name in the nav", () => {
  render(<App />);
  expect(screen.getAllByText(/Tiwari/i).length).toBeGreaterThan(0);
});
