import { render, screen, waitFor, act, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import FieldVisitsPage from "../pages/FieldVisitsPage";
import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { ToastProvider } from "../context/ToastContext";
import { beneficiariesApi } from "../api/beneficiariesApi";

vi.mock("../api/fieldVisitsApi", () => ({
  fieldVisitsApi: {
    list: vi.fn(),
    options: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    uploadPhoto: vi.fn(),
    removePhoto: vi.fn(),
  },
}));

// The geotag pipeline is mocked at the boundary: it returns a fixed capture
// (clock fields, no GPS fix — the no-location path) and a blob stub, so the
// form flow is exercised without a real camera, canvas or GPS sensor.
const geotag = vi.hoisted(() => ({
  captureGeotag: vi.fn(),
}));

vi.mock("../lib/geotagPhoto", () => ({
  captureGeotag: geotag.captureGeotag,
}));

const CAPTURE = {
  meta: {
    capture_date: "2026-09-25",
    capture_time: "11:45:32",
    timezone_offset: "UTC+08:00",
    capture_year: 2026,
    capture_month: 9,
    capture_day: 25,
    capture_hour: 11,
    capture_minute: 45,
    capture_second: 32,
    capture_millisecond: 500,
    latitude: null,
    longitude: null,
    accuracy_m: null,
    altitude_m: null,
    speed_kmh: null,
    heading_deg: null,
    location_source: "none",
    address: null,
    gps_timestamp: null,
  },
  photo: { blob: new Blob(["x"], { type: "image/jpeg" }), dataUrl: "data:image/jpeg;base64,xyz", width: 800, height: 600 },
};

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
}));

const auth = { user: { id: 7, name: "Jun Technician", role: "technician" } };
vi.mock("../context/AuthContext", () => ({
  useAuth: () => auth,
}));

const PURPOSES = ["routine-monitoring", "follow-up", "vaccination", "dispersal", "complaint", "other"];

const VISITS = [
  {
    id: 1,
    beneficiary_id: 11,
    technician_id: 7,
    technician: { id: 7, name: "Jun Technician" },
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    visited_on: "2026-09-20",
    purpose: "routine-monitoring",
    notes: "Checked the carabao.",
    latitude: 9.3814,
    longitude: 122.80916,
    has_location: true,
    registered_latitude: 9.3714,
    registered_longitude: 122.80916,
    distance_from_registered_m: 1112,
  },
  {
    id: 2,
    beneficiary_id: 12,
    technician_id: 7,
    technician: { id: 7, name: "Jun Technician" },
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Swine",
    sex: "F",
    visited_on: "2026-09-18",
    purpose: "follow-up",
    notes: "Nobody home.",
    latitude: null,
    longitude: null,
    has_location: false,
    registered_latitude: null,
    registered_longitude: null,
    distance_from_registered_m: null,
  },
  {
    id: 3,
    beneficiary_id: 13,
    technician_id: 99,
    technician: { id: 99, name: "Other Technician" },
    name_of_farmer: "Ima Johnston",
    address: "Daw-Kal-Vil",
    animal_type: "Swine",
    sex: "F",
    visited_on: "2026-09-15",
    purpose: "complaint",
    notes: null,
    latitude: null,
    longitude: null,
    has_location: false,
    registered_latitude: null,
    registered_longitude: null,
    distance_from_registered_m: null,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <FieldVisitsPage roleKey="technician" />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function table() {
  return within(screen.getByRole("table"));
}

describe("FieldVisitsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 7, name: "Jun Technician", role: "technician" };
    fieldVisitsApi.list.mockResolvedValue(VISITS);
    fieldVisitsApi.options.mockResolvedValue({ purposes: PURPOSES });
    fieldVisitsApi.uploadPhoto.mockResolvedValue({ id: 1 });
    geotag.captureGeotag.mockResolvedValue(CAPTURE);
    beneficiariesApi.list.mockResolvedValue([
      { id: 11, name_of_farmer: "Aling Nena", address: "Banay Banay", animal_type: "Carabao", sex: "F" },
    ]);
  });

  it("lists the trips with their purpose and captured location", async () => {
    renderPage();

    expect(await screen.findByText("Aling Nena")).toBeInTheDocument();
    expect(table().getByText("Routine monitoring")).toBeInTheDocument();
    expect(table().getByText("Captured")).toBeInTheDocument();
  });

  it("expresses the distance from the registered pin in km once it is large", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(table().getByText("1.1 km from the registered pin")).toBeInTheDocument();
  });

  it("says a visit has no fix rather than leaving it blank", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    // Two visits have no captured position.
    expect(table().getAllByText("Not captured")).toHaveLength(2);
  });

  it("offers edit and delete only on the technician's own trips", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  it("logs a trip without any animal-condition fields, after the required photo", async () => {
    fieldVisitsApi.create.mockResolvedValue({ ...VISITS[0], id: 9 });
    fieldVisitsApi.uploadPhoto.mockResolvedValue({ id: 1 });

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Log a Field Visit" }));
    });

    // This is the distinction the module rests on: a trip is not an observation.
    expect(screen.queryByLabelText(/BCS/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/vaccination/i)).not.toBeInTheDocument();

    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Beneficiary visited"), "11");
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Purpose"), "follow-up");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Notes"), "Nobody home.");
    });

    // New visits require the geotagged photo before they can be logged.
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Log field visit" }));
    });
    expect(
      await screen.findByText("Take the geotagged photo before logging the visit."),
    ).toBeInTheDocument();
    expect(fieldVisitsApi.create).not.toHaveBeenCalled();

    // Capture through the mocked geotag pipeline (jsdom can't open a real
    // camera/file dialog, so the change event is fired on the input directly),
    // then submit.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Take photo with camera"), {
        target: { files: [new File(["x"], "shot.jpg", { type: "image/jpeg" })] },
      });
    });
    await screen.findByAltText("Captured visit photo with location panel");
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Log field visit" }));
    });

    await waitFor(() => {
      expect(fieldVisitsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          beneficiary_id: 11,
          purpose: "follow-up",
          notes: "Nobody home.",
          has_photo: true,
          // No GPS captured, so the pair is sent as null rather than omitted.
          latitude: null,
          longitude: null,
        }),
      );
    });
    await waitFor(() => {
      expect(fieldVisitsApi.uploadPhoto).toHaveBeenCalledWith(
        9,
        expect.any(Blob),
        expect.objectContaining({ capture_date: "2026-09-25", latitude: null }),
      );
    });
  });

  it("requires a purpose before saving", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Log a Field Visit" }));
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Beneficiary visited"), "11");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Log field visit" }));
    });

    expect(fieldVisitsApi.create).not.toHaveBeenCalled();
    expect(screen.getByText("Choose why you went out.")).toBeInTheDocument();
  });

  it("reports when geolocation is unavailable instead of failing silently", async () => {
    // jsdom has no geolocation, which is exactly the field edge case.
    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Log a Field Visit" }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Capture my position" }));
    });

    expect(
      screen.getByText("Geolocation is not available in this browser."),
    ).toBeInTheDocument();
  });

  it("does not fetch the beneficiary picker for a role that cannot log", async () => {
    auth.user = { id: 5, name: "Aling Nena", role: "farmer" };

    renderPage();
    await screen.findByText("Aling Nena");

    expect(beneficiariesApi.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Log a Field Visit" })).not.toBeInTheDocument();
  });

  it("surfaces an API failure", async () => {
    fieldVisitsApi.list.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
