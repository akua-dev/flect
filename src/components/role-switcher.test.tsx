// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleSwitcher } from "./role-switcher";

afterEach(cleanup);

describe("RoleSwitcher", () => {
  it("announces the selected role before switching", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RoleSwitcher disabled={false} mode="edit" onChange={onChange} />);

    expect(
      screen.getByRole("button", { name: "Edit · Shaper" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Run · App Agent" }));
    expect(onChange).toHaveBeenCalledWith("run");
  });

  it("blocks both destinations while an agent is active", () => {
    render(<RoleSwitcher disabled mode="run" onChange={() => undefined} />);

    expect(
      screen.getByRole("button", { name: "Edit · Shaper" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Run · App Agent" }),
    ).toBeDisabled();
  });
});
