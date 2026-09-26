import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MonitoringTable } from "../components/MonitoringTable";

/**
 * The admin oversight columns: Technician (the beneficiary's assigned
 * technician) and Timestamp (the most recent field-visit photo's capture
 * time), plus the photo lightbox opened from the thumbnail.
 */

const RECORD_ASSIGNED = {
  id: 1,
  name_of_farmer: "Aling Nena",
  address: "Banay Banay",
  animal_type: "Carabao",
  sex: "F",
  date_monitored: "2026-09-20",
  assigned_technician: { id: 7, name: "Jun Tech" },
  latest_field_visit_photo: {
    id: 31,
    image_url: "http://localhost/storage/field-visits/1/shot.jpg",
    capture_date: "2026-09-18",
    capture_time: "08:30:00",
    address: "Dawis, Bayawan City",
  },
};

const RECORD_UNASSIGNED_NO_PHOTO = {
  id: 2,
  name_of_farmer: "Doyle Walter",
  address: "Dawis",
  animal_type: "Swine",
  sex: "F",
  date_monitored: "2026-09-19",
  assigned_technician: null,
  latest_field_visit_photo: null,
};

function renderTable(records = [RECORD_ASSIGNED, RECORD_UNASSIGNED_NO_PHOTO]) {
  return render(<MonitoringTable records={records} />);
}

describe("MonitoringTable technician + timestamp columns", () => {
  it("shows the assigned technician's name", async () => {
    renderTable();

    expect(await screen.findByText("Jun Tech")).toBeInTheDocument();
  });

  it("renders Unassigned distinctly when no technician is assigned", async () => {
    renderTable();

    const cell = (await screen.findByText("Unassigned")).closest("td");
    expect(cell).not.toBeNull();
    // Muted/italic so gaps are visible at a glance.
    expect(cell?.querySelector(".italic")).not.toBeNull();
  });

  it("shows the most recent photo's capture timestamp and a thumbnail", async () => {
    renderTable();

    const timestamp = await screen.findByText(/9\/18\/2026/);
    expect(timestamp).toBeInTheDocument();

    const thumb = screen.getByAltText("Visit photo thumbnail");
    expect(thumb).toHaveAttribute("src", RECORD_ASSIGNED.latest_field_visit_photo.image_url);
  });

  it("leaves the timestamp cell empty when the record has no photo", async () => {
    renderTable();

    await screen.findByText("Jun Tech");

    const row = screen.getByText("Doyle Walter").closest("tr");
    expect(row?.textContent).not.toMatch(/9\/18\/2026/);
    expect(within(row).queryByAltText("Visit photo thumbnail")).toBeNull();
  });

  it("opens the full-size photo in a lightbox with structured metadata", async () => {
    renderTable();

    await userEvent.click(await screen.findByRole("button", { name: /view full-size photo/i }));

    const dialog = await screen.findByRole("dialog", { name: /visit photo — aling nena/i });
    expect(within(dialog).getByRole("img", { name: /geotagged visit photo/i })).toHaveAttribute(
      "src",
      RECORD_ASSIGNED.latest_field_visit_photo.image_url,
    );
    // Structured stored fields as the caption — the pixels already carry
    // the burned-in panel, the caption is the machine-readable truth.
    expect(within(dialog).getByText("Dawis, Bayawan City")).toBeInTheDocument();
    expect(within(dialog).getByText("Jun Tech")).toBeInTheDocument();
  });

  it("closes the lightbox with the close button", async () => {
    renderTable();
    await userEvent.click(await screen.findByRole("button", { name: /view full-size photo/i }));
    await screen.findByRole("dialog", { name: /visit photo/i });

    await userEvent.click(screen.getByRole("button", { name: "Close photo" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("closes the lightbox on Escape", async () => {
    renderTable();
    await userEvent.click(await screen.findByRole("button", { name: /view full-size photo/i }));
    await screen.findByRole("dialog", { name: /visit photo/i });

    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
