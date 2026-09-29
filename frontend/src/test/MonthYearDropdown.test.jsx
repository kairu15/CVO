import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MonthYearDropdown, monthTabLabel } from "../components/MonthYearDropdown";

/**
 * The month/year dropdown in isolation: label helper, year grouping with
 * calendar order, keyboard operation (arrows / Home / End / Enter / Escape /
 * Tab), the active-option highlight, and click-outside closing.
 */

const MONTHS = ["2026-09", "2024-06", "2025-01", "2026-01"];

async function open() {
  await userEvent.setup().click(screen.getByRole("combobox", { name: /filter monitoring records by month/i }));

  return screen.getByRole("listbox", { name: /filter monitoring records by month/i });
}

describe("monthTabLabel", () => {
  it("formats YYYY-MM keys as MMM YYYY", () => {
    expect(monthTabLabel("2026-09")).toBe("Sep 2026");
    expect(monthTabLabel("2024-06")).toBe("Jun 2024");
  });

  it("passes through malformed keys unchanged", () => {
    expect(monthTabLabel("September")).toBe("September");
    expect(monthTabLabel("2026-13")).toBe("2026-13");
  });
});

describe("MonthYearDropdown rendering", () => {
  it("renders nothing when no months have records", () => {
    const { container } = render(<MonthYearDropdown months={[]} onSelect={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows All months first, then options grouped by year, newest first", async () => {
    render(<MonthYearDropdown months={MONTHS} onSelect={vi.fn()} />);

    await open();

    const labels = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((option) => option.textContent.trim());

    expect(labels).toEqual([
      "All months",
      "Jan 2026",
      "Sep 2026",
      "Jan 2025",
      "Jun 2024",
    ]);
    // Year headings render between the groups.
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("2025")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
  });

  it("reflects the selection on the trigger and marks exactly one option", async () => {
    render(<MonthYearDropdown months={MONTHS} selected="2026-09" onSelect={vi.fn()} />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Sep 2026");

    const listbox = await open();
    const selected = within(listbox).getAllByRole("option", { selected: true });

    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("aria-selected", "true");
  });
});

describe("MonthYearDropdown interaction", () => {
  let onSelect;

  beforeEach(() => {
    onSelect = vi.fn();
  });

  it("chooses an option on click and closes", async () => {
    const user = userEvent.setup();
    render(<MonthYearDropdown months={MONTHS} onSelect={onSelect} />);

    const listbox = await open();
    await user.click(within(listbox).getByRole("option", { name: "Jun 2024" }));

    expect(onSelect).toHaveBeenLastCalledWith("2024-06");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("chooses All months with null", async () => {
    const user = userEvent.setup();
    render(<MonthYearDropdown months={MONTHS} selected="2024-06" onSelect={onSelect} />);

    const listbox = await open();
    await user.click(within(listbox).getByRole("option", { name: "All months" }));

    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("toggles closed on a second trigger click", async () => {
    const user = userEvent.setup();
    render(<MonthYearDropdown months={MONTHS} onSelect={onSelect} />);

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes on click outside without changing the selection", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <MonthYearDropdown months={MONTHS} onSelect={onSelect} />
        <button type="button">Outside</button>
      </div>,
    );

    await open();

    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens with ArrowDown and picks the highlighted option with Enter", async () => {
    const user = userEvent.setup();
    render(<MonthYearDropdown months={MONTHS} onSelect={onSelect} />);

    const trigger = screen.getByRole("combobox");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    // ArrowDown opens with the highlight on the current selection — "All
    // months" here — so Enter picks it.
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves the highlight with arrow keys and clamps at the ends", async () => {
    const user = userEvent.setup();
    render(<MonthYearDropdown months={MONTHS} selected="2024-06" onSelect={onSelect} />);

    await open();
    const trigger = screen.getByRole("combobox");
    trigger.focus();

    // The highlight starts on the selection — the last option (Jun 2024) —
    // and tracks it through aria-activedescendant.
    expect(trigger).toHaveAttribute("aria-activedescendant", "monitoring-month-option-4");

    // ArrowDown clamps at the end…
    await user.keyboard("{ArrowDown}");
    expect(trigger).toHaveAttribute("aria-activedescendant", "monitoring-month-option-4");

    // …ArrowUp steps back one (Jan 2025)…
    await user.keyboard("{ArrowUp}");
    expect(trigger).toHaveAttribute("aria-activedescendant", "monitoring-month-option-3");

    // …and Home jumps to the first option (All months).
    await user.keyboard("{Home}");
    expect(trigger).toHaveAttribute("aria-activedescendant", "monitoring-month-option-0");

    // The highlighted option is visually marked with the brand tint.
    expect(
      within(screen.getByRole("listbox")).getByRole("option", { name: "All months" }),
    ).toHaveClass("bg-brand-50");
  });

  it("picks the option highlighted by arrow keys with Enter", async () => {
    const user = userEvent.setup();
    render(<MonthYearDropdown months={MONTHS} selected="2026-01" onSelect={onSelect} />);

    await open();
    const trigger = screen.getByRole("combobox");
    trigger.focus();

    // Selected "Jan 2026" is option 1; ArrowDown highlights "Sep 2026",
    // and Enter picks the highlighted option, not the selected one.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenLastCalledWith("2026-09");
  });

  it("closes on Escape without choosing", async () => {
    const user = userEvent.setup();
    render(<MonthYearDropdown months={MONTHS} onSelect={onSelect} />);

    await open();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on Tab without choosing", async () => {
    const user = userEvent.setup();
    render(<MonthYearDropdown months={MONTHS} onSelect={onSelect} />);

    await open();
    await user.tab();

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
