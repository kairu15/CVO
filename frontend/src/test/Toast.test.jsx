import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../context/ToastContext";

function ToastHarness() {
  const toast = useToast();

  return (
    <div>
      <button type="button" onClick={() => toast.success("Beneficiary added successfully.")}>
        Show success
      </button>
      <button type="button" onClick={() => toast.error("Unable to save the record.")}>
        Show error
      </button>
      <button type="button" onClick={() => toast.warning("Complete all required fields.")}>
        Show warning
      </button>
      <button type="button" onClick={() => toast.info("Your changes have been saved.")}>
        Show information
      </button>
      <button
        type="button"
        onClick={() => toast.error("Review this message.", { persistent: true })}
      >
        Show persistent
      </button>
    </div>
  );
}

function renderToasts() {
  return render(
    <ToastProvider>
      <ToastHarness />
    </ToastProvider>,
  );
}

const show = (name) => fireEvent.click(screen.getByRole("button", { name }));

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders all four variants with their accessible roles and accents", () => {
    renderToasts();

    show("Show success");
    show("Show warning");
    show("Show error");
    show("Show information");

    const success = screen.getByText("Beneficiary added successfully.").closest("[data-toast-variant]");
    const warning = screen.getByText("Complete all required fields.").closest("[data-toast-variant]");
    const error = screen.getByText("Unable to save the record.").closest("[data-toast-variant]");
    const information = screen.getByText("Your changes have been saved.").closest("[data-toast-variant]");

    expect(success).toHaveAttribute("role", "status");
    expect(success.className).toContain("border-l-brand-600");
    expect(warning).toHaveAttribute("role", "alert");
    expect(warning.className).toContain("border-l-amber-500");
    expect(error).toHaveAttribute("role", "alert");
    expect(error.className).toContain("border-l-red-600");
    expect(information).toHaveAttribute("role", "status");
    expect(information.className).toContain("border-l-sky-500");
  });

  it("uses the top-center viewport and stacks the newest notification first", () => {
    renderToasts();

    show("Show success");
    show("Show information");

    const viewport = screen.getByRole("region", { name: "Notifications" });
    expect(viewport.className).toContain("top-20");
    expect(viewport.className).toContain("left-1/2");
    expect(viewport.className).toContain("max-w-md");

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toHaveTextContent("Your changes have been saved.");
    expect(statuses[1]).toHaveTextContent("Beneficiary added successfully.");
  });

  it("auto-dismisses after the variant lifetime", () => {
    renderToasts();
    show("Show success");
    show("Show information");

    expect(screen.getByText("Beneficiary added successfully.")).toBeInTheDocument();
    expect(screen.getByText("Your changes have been saved.")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByText("Beneficiary added successfully.").closest("[data-toast-variant]")).toHaveClass("toast-exit");
    expect(screen.getByText("Your changes have been saved.")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(201));
    expect(screen.queryByText("Beneficiary added successfully.")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(799));
    expect(screen.getByText("Your changes have been saved.").closest("[data-toast-variant]")).toHaveClass("toast-exit");
    act(() => vi.advanceTimersByTime(201));
    expect(screen.queryByText("Your changes have been saved.")).not.toBeInTheDocument();
  });

  it("pauses on hover and resumes with the remaining time", () => {
    renderToasts();
    show("Show information");

    const message = screen.getByText("Your changes have been saved.");
    const card = message.closest("[data-toast-variant]");

    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(10_000));

    expect(screen.getByText("Your changes have been saved.")).toBeInTheDocument();

    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.getByText("Your changes have been saved.")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Your changes have been saved.").closest("[data-toast-variant]")).toHaveClass("toast-exit");
    act(() => vi.advanceTimersByTime(201));
    expect(screen.queryByText("Your changes have been saved.")).not.toBeInTheDocument();
  });

  it("pauses while the close button is focused", () => {
    renderToasts();
    show("Show error");

    const card = screen.getByText("Unable to save the record.").closest("[data-toast-variant]");
    const close = within(card).getByRole("button", { name: "Dismiss notification" });

    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.focus(close);
    act(() => vi.advanceTimersByTime(10_000));

    expect(screen.getByText("Unable to save the record.")).toBeInTheDocument();

    fireEvent.blur(close);
    act(() => vi.advanceTimersByTime(5_500));
    expect(screen.getByText("Unable to save the record.").closest("[data-toast-variant]")).toHaveClass("toast-exit");
    act(() => vi.advanceTimersByTime(201));
    expect(screen.queryByText("Unable to save the record.")).not.toBeInTheDocument();
  });

  it("coalesces duplicate messages instead of stacking them", () => {
    renderToasts();

    show("Show success");
    show("Show success");

    expect(screen.getAllByText("Beneficiary added successfully.")).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("keeps persistent messages until they are dismissed", () => {
    renderToasts();
    show("Show persistent");

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Review this message.")).toBeInTheDocument();
    expect(screen.queryByText("Review this message.").closest("[data-toast-variant]").querySelector(".toast-progress")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.getByText("Review this message.").closest("[data-toast-variant]")).toHaveClass("toast-exit");

    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Review this message.")).not.toBeInTheDocument();
  });

  it("queues notifications beyond the visible stack", () => {
    function QueueHarness() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast.success("First");
            toast.info("Second");
            toast.warning("Third");
            toast.error("Fourth");
            toast.success("Fifth");
          }}
        >
          Queue five
        </button>
      );
    }

    render(
      <ToastProvider>
        <QueueHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Queue five" }));

    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Fifth")).toBeInTheDocument();
    expect(screen.getAllByText(/^(Second|Third|Fourth|Fifth)$/)).toHaveLength(4);

    const fifthCard = screen.getByText("Fifth").closest("[data-toast-variant]");
    fireEvent.click(within(fifthCard).getByRole("button", { name: "Dismiss notification" }));
    act(() => vi.advanceTimersByTime(201));

    expect(screen.getByText("First")).toBeInTheDocument();
  });
});
