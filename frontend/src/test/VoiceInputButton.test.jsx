import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInputButton } from "../components/VoiceInputButton";

/** Minimal stand-in for a browser's SpeechRecognition implementation. */
class MockRecognition {
  static instances = [];

  constructor() {
    MockRecognition.instances.push(this);
  }

  start() {
    this.started = true;
  }

  stop() {
    this.stopped = true;
  }

  abort() {
    this.aborted = true;
  }
}

/** One speech result item: array-like of alternatives, with `isFinal`. */
function result(transcript, isFinal) {
  return Object.assign([{ transcript }], { isFinal });
}

function renderButton(props = {}) {
  return render(<VoiceInputButton onTranscript={vi.fn()} {...props} />);
}

describe("VoiceInputButton", () => {
  beforeEach(() => {
    MockRecognition.instances = [];
    window.SpeechRecognition = MockRecognition;
  });

  afterEach(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  it("hides the mic entirely when the browser has no Web Speech API", () => {
    delete window.SpeechRecognition;

    renderButton();

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/browser's built-in speech recognition/)).not.toBeInTheDocument();
  });

  it("shows the mic and the honest disclaimer when supported", () => {
    renderButton();

    expect(screen.getByRole("button", { name: "Dictate note" })).toBeInTheDocument();
    // Not presented as fully offline — audio may be processed by the browser.
    expect(
      screen.getByText(/your browser may send the audio to its speech service/i),
    ).toBeInTheDocument();
  });

  it("starts listening, shows an indicator, and appends finalized text", async () => {
    const user = userEvent.setup();
    const onTranscript = vi.fn();

    renderButton({ onTranscript });

    await user.click(screen.getByRole("button", { name: "Dictate note" }));

    const recognition = MockRecognition.instances[0];
    expect(recognition.started).toBe(true);
    expect(screen.getByText("Listening…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop dictation" })).toBeInTheDocument();

    act(() => {
      recognition.onresult({
        resultIndex: 0,
        results: [result("carabao limping", true)],
      });
    });

    expect(onTranscript).toHaveBeenCalledWith("carabao limping");
  });

  it("shows interim text while the technician is still speaking", async () => {
    const user = userEvent.setup();

    renderButton();
    await user.click(screen.getByRole("button", { name: "Dictate note" }));

    const recognition = MockRecognition.instances[0];

    act(() => {
      recognition.onresult({
        resultIndex: 0,
        results: [result("nobody home", false)],
      });
    });

    expect(screen.getByText(/“nobody home”/)).toBeInTheDocument();
  });

  it("stops listening when the technician presses stop", async () => {
    const user = userEvent.setup();

    renderButton();
    await user.click(screen.getByRole("button", { name: "Dictate note" }));
    await user.click(screen.getByRole("button", { name: "Stop dictation" }));

    expect(MockRecognition.instances[0].stopped).toBe(true);
    expect(screen.queryByText("Listening…")).not.toBeInTheDocument();
  });

  it("surfaces a blocked microphone instead of failing silently", async () => {
    const user = userEvent.setup();

    renderButton();
    await user.click(screen.getByRole("button", { name: "Dictate note" }));

    act(() => {
      MockRecognition.instances[0].onerror({ error: "not-allowed" });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/Microphone access was blocked/);
  });

  it("never renders a submit button — dictation only edits text", async () => {
    renderButton();

    const button = screen.getByRole("button", { name: "Dictate note" });

    expect(button).toHaveAttribute("type", "button");
  });

  it("falls back to the webkit-prefixed constructor", () => {
    delete window.SpeechRecognition;
    window.webkitSpeechRecognition = MockRecognition;

    renderButton();

    expect(screen.getByRole("button", { name: "Dictate note" })).toBeInTheDocument();
  });
});
