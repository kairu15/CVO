import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignaturePad } from "../components/SignaturePad";

/**
 * jsdom has no canvas backend, so the 2D context and toDataURL are stubbed:
 * the test drives the pointer -> canvas -> onChange path, which is the whole
 * contract of the pad, without real pixels.
 */
const ctx = {
  scale: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
  lineWidth: 0,
  lineCap: "",
  lineJoin: "",
  strokeStyle: "",
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,AAAA",
  );
  Object.values(ctx).forEach((value) => value?.mockClear?.());
});

describe("SignaturePad", () => {
  it("sizes the canvas and shows the draw hint", () => {
    render(<SignaturePad onChange={vi.fn()} />);

    const canvas = screen.getByTestId("signature-canvas");
    // getBoundingClientRect is 0 in jsdom, so the component falls back.
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(180);
    expect(canvas).toHaveAttribute("data-signed", "false");
    expect(
      screen.getByText(/sign inside the box with a finger/i),
    ).toBeInTheDocument();
  });

  it("emits a PNG data URL after a stroke", () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);

    const canvas = screen.getByTestId("signature-canvas");
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 24 });
    fireEvent.pointerUp(canvas, { clientX: 30, clientY: 24 });

    expect(onChange).toHaveBeenCalledWith("data:image/png;base64,AAAA");
    expect(canvas).toHaveAttribute("data-signed", "true");
    expect(screen.getByText("Signature captured.")).toBeInTheDocument();
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("clears the pad and emits null", () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);

    const canvas = screen.getByTestId("signature-canvas");
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 5 });
    onChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(canvas).toHaveAttribute("data-signed", "false");
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it("shows a validation error against the pad", () => {
    render(<SignaturePad onChange={vi.fn()} error="Capture the signature." />);

    expect(screen.getByText("Capture the signature.")).toBeInTheDocument();
  });
});
