import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapInfoPanel } from "../components/MapInfoPanel";

/**
 * The shared panel is the map's accessible detail surface: a labelled dialog,
 * a real close button, Escape support, and no DOM at all while closed. The
 * responsive side-card / bottom-sheet split is CSS; these assertions cover
 * the behaviour every page relies on.
 */

function renderPanel(props = {}) {
  return render(
    <MapInfoPanel open onClose={() => {}} title="Dawis" subtitle="Bayawan City barangay" {...props}>
      <p>Panel body</p>
    </MapInfoPanel>,
  );
}

describe("MapInfoPanel", () => {
  it("renders a labelled dialog with its content and close control", () => {
    renderPanel();

    const dialog = screen.getByRole("dialog", { name: /selected location details/i });
    expect(dialog).toHaveTextContent("Dawis");
    expect(dialog).toHaveTextContent("Bayawan City barangay");
    expect(dialog).toHaveTextContent("Panel body");
    expect(screen.getByRole("button", { name: /close details/i })).toBeInTheDocument();
  });

  it("closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /close details/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing while closed", () => {
    render(
      <MapInfoPanel open={false} onClose={() => {}} title="Dawis">
        <p>Body</p>
      </MapInfoPanel>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
