import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogoutConfirmDialog } from "../components/LogoutConfirmDialog";
import { ToastProvider } from "../context/ToastContext";

const auth = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ logout: auth.logout }),
}));

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}</p>;
}

function Harness({ onClosed = vi.fn() }) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef(null);

  return (
    <MemoryRouter initialEntries={["/dashboard/admin"]}>
      <ToastProvider>
        <button ref={triggerRef} type="button">
          Open logout
        </button>
        <LogoutConfirmDialog
          open={open}
          onClose={() => {
            setOpen(false);
            onClosed();
          }}
          returnFocusRef={triggerRef}
        />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>
  );
}

function renderDialog(onClosed) {
  const user = userEvent.setup();
  render(<Harness onClosed={onClosed} />);
  return { user, dialog: screen.getByRole("dialog", { name: "Log out" }) };
}

describe("LogoutConfirmDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the confirmation content and focuses Cancel first", async () => {
    const { dialog } = renderDialog();

    expect(within(dialog).getByText(/Are you sure you want to log out\?/)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
    expect(within(dialog).getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });

  it("traps focus and restores it to the trigger after Cancel", async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);

    const dialog = screen.getByRole("dialog", { name: "Log out" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const close = within(dialog).getByRole("button", { name: "Close dialog" });

    await waitFor(() => expect(cancel).toHaveFocus());
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.click(cancel);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(auth.logout).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open logout" })).toHaveFocus();
  });

  it("closes through the X button, Escape and the backdrop", async () => {
    const user = userEvent.setup();
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);

    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    onClosed.mockClear();
    render(<Harness onClosed={onClosed} />);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClosed).toHaveBeenCalledTimes(1);

    onClosed.mockClear();
    render(<Harness onClosed={onClosed} />);
    fireEvent.click(document.querySelector(".fixed.inset-0.z-50 > div[aria-hidden='true']"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("locks every dismissal path and prevents duplicate requests while logging out", async () => {
    auth.logout.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);

    const dialog = screen.getByRole("dialog", { name: "Log out" });
    await user.click(within(dialog).getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole("button", { name: "Logging out..." })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toBeDisabled();
    expect(dialog.querySelector(".animate-spin")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Logging out..." }));
    await user.keyboard("{Escape}");
    fireEvent.click(document.querySelector(".fixed.inset-0.z-50 > div[aria-hidden='true']"));

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Log out" })).toBeInTheDocument();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("redirects to login after a confirmed logout", async () => {
    auth.logout.mockResolvedValue({ ok: true, serverError: null });
    const { user, dialog } = renderDialog();

    await user.click(within(dialog).getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/login"));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it("shows an error when the server cannot confirm logout", async () => {
    auth.logout.mockResolvedValue({ ok: false, serverError: new Error("gateway") });
    const { user, dialog } = renderDialog();

    await user.click(within(dialog).getByRole("button", { name: "Log out" }));

    expect(
      await screen.findByText(/server could not confirm it/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("path")).toHaveTextContent("/login");
  });

  it("keeps the dialog open and reports an unexpected logout failure", async () => {
    auth.logout.mockRejectedValue({ request: {}, message: "Network Error" });
    const { user, dialog } = renderDialog();

    await user.click(within(dialog).getByRole("button", { name: "Log out" }));

    expect(await within(dialog).findByText(/Couldn't log out/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Log out" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByTestId("path")).toHaveTextContent("/dashboard/admin");
  });
});
