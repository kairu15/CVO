import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { HealthConcernHints } from "../components/HealthConcernHints";
import { matchSymptomRules } from "../lib/symptomMatching";
import { symptomRulesApi } from "../api/symptomRulesApi";

vi.mock("../api/symptomRulesApi", () => ({
  symptomRulesApi: { active: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const RULES = [
  { id: 1, label: "Digestive upset", keywords: ["diarrhea", "loose stool"], hint: "Check for dehydration.", animal_type: null, is_active: true },
  { id: 2, label: "Lameness", keywords: ["limp"], hint: "Examine the limb.", animal_type: null, is_active: true },
  { id: 3, label: "Swine fever", keywords: ["fever"], hint: "Swine only.", animal_type: "Swine", is_active: true },
  { id: 4, label: "Retired", keywords: ["cough"], hint: "Should never show.", animal_type: null, is_active: false },
];

describe("matchSymptomRules", () => {
  it("matches any keyword, case-insensitively", () => {
    const matched = matchSymptomRules(RULES, "The animal has DIARRHEA today", null);
    expect(matched.map((r) => r.label)).toEqual(["Digestive upset"]);
  });

  it("matches a multi-word phrase as a phrase", () => {
    expect(matchSymptomRules(RULES, "noticed loose stool", null)).toHaveLength(1);
    expect(matchSymptomRules(RULES, "loose", null)).toHaveLength(0);
  });

  it("returns nothing for empty text", () => {
    expect(matchSymptomRules(RULES, "   ", null)).toEqual([]);
  });

  it("excludes retired rules", () => {
    expect(matchSymptomRules(RULES, "persistent cough", null)).toEqual([]);
  });

  it("only applies a species-scoped rule when the type matches", () => {
    expect(matchSymptomRules(RULES, "high fever", "Swine")).toHaveLength(1);
    expect(matchSymptomRules(RULES, "high fever", "Goat")).toEqual([]);
    // Unknown species: prefer silence over a wrong hint.
    expect(matchSymptomRules(RULES, "high fever", null)).toEqual([]);
  });
});

function renderHints(props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  return render(
    <QueryClientProvider client={client}>
      <HealthConcernHints {...props} />
    </QueryClientProvider>,
  );
}

describe("HealthConcernHints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    symptomRulesApi.active.mockResolvedValue(RULES);
  });

  it("labels the hint as decision support, not a diagnosis", async () => {
    renderHints({ text: "Animal has diarrhea", animalType: "Cattle" });

    expect(
      await screen.findByText(/Possible concern — not a diagnosis\. Consult a veterinarian\./),
    ).toBeInTheDocument();
    expect(screen.getByText("Digestive upset")).toBeInTheDocument();
    expect(screen.getByText("Check for dehydration.")).toBeInTheDocument();
  });

  it("renders nothing when no rule matches", async () => {
    renderHints({ text: "Animal is in good health", animalType: "Cattle" });

    await waitFor(() => expect(symptomRulesApi.active).toHaveBeenCalled());

    expect(screen.queryByText(/Possible concern/)).not.toBeInTheDocument();
  });

  it("does not present itself as AI or a model", async () => {
    renderHints({ text: "diarrhea", animalType: null });
    await screen.findByText("Digestive upset");

    expect(screen.getByText(/Matched from keywords by a fixed rule table/)).toBeInTheDocument();
  });

  it("lets the doctor dismiss an individual hint", async () => {
    const user = userEvent.setup();
    renderHints({ text: "diarrhea and limping", animalType: null });

    await screen.findByText("Digestive upset");
    expect(screen.getByText("Lameness")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss hint: Digestive upset" }));

    expect(screen.queryByText("Digestive upset")).not.toBeInTheDocument();
    expect(screen.getByText("Lameness")).toBeInTheDocument();
  });
});
