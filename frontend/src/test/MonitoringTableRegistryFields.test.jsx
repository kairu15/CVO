import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MonitoringTable } from "../components/MonitoringTable";

/**
 * The registry/agreement columns added to the monitoring table: RSBSA # (a
 * farmer-level ID beside the name), MOA (a togglable badge beside Remarks) and
 * Ear Tag #. Missing values must read as "not yet recorded", never as a blank
 * cell that looks like a rendering bug.
 */

const WITH_VALUES = {
  id: 1,
  name_of_farmer: "Juan Dela Cruz",
  rsbsa_number: "12-34-56-789-000012",
  address: "Ali-is",
  animal_type: "Cattle",
  sex: "M",
  date_monitored: "2026-09-20",
  ear_tag_number: "ET-0001",
  moa_signed: true,
  assigned_technician: null,
  latest_field_visit_photo: null,
  registration_status: "none",
  is_new: false,
};

const MISSING_VALUES = {
  ...WITH_VALUES,
  id: 2,
  name_of_farmer: "Nena Reyes",
  rsbsa_number: null,
  ear_tag_number: null,
  moa_signed: null,
};

describe("MonitoringTable registry fields", () => {
  it("shows RSBSA # and Ear Tag # values and the MOA badge", () => {
    render(<MonitoringTable records={[WITH_VALUES]} />);

    const row = screen.getByText("Juan Dela Cruz").closest("tr");
    expect(within(row).getByText("12-34-56-789-000012")).toBeInTheDocument();
    expect(within(row).getByText("ET-0001")).toBeInTheDocument();
    // MOA renders as a labelled badge, not a raw boolean.
    expect(within(row).getByText("Yes")).toBeInTheDocument();
  });

  it("shows a placeholder rather than a blank cell when a value is missing", () => {
    render(<MonitoringTable records={[MISSING_VALUES]} />);

    const row = screen.getByText("Nena Reyes").closest("tr");
    // RSBSA # and Ear Tag # fall back to the em-dash placeholder…
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // …and an unrecorded MOA reads as "Not on file", not "No".
    expect(within(row).getByText("Not on file")).toBeInTheDocument();
    expect(within(row).queryByText("No")).toBeNull();
  });

  it("renders the MOA badge read-only when no toggle handler is supplied", () => {
    render(<MonitoringTable records={[WITH_VALUES]} />);

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });

  it("flips the MOA status through the inline switch", async () => {
    const onToggleMoa = vi.fn();
    render(<MonitoringTable records={[MISSING_VALUES]} onToggleMoa={onToggleMoa} />);

    const toggle = screen.getByRole("switch", {
      name: /toggle moa status for nena reyes/i,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await userEvent.click(toggle);

    expect(onToggleMoa).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });

  it("disables the switch and shows a spinner while the save is in flight", () => {
    render(<MonitoringTable records={[WITH_VALUES]} onToggleMoa={vi.fn()} moaBusyId={1} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    // The badge is replaced by the in-flight spinner while saving.
    expect(screen.queryByText("Yes")).toBeNull();
  });
});
