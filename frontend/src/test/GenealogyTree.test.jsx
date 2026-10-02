import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenealogyTree } from "../components/GenealogyTree";

const TREE = [
  {
    event_id: 1,
    beneficiary_id: 2,
    parent_beneficiary_id: 1,
    name_of_farmer: "Mid Farmer",
    address: "Kalumboyan",
    animal_type: "Carabao",
    sex: "F",
    date_dispersed: "2026-01-01",
    remarks: null,
    generation: 1,
    children: [
      {
        event_id: 2,
        beneficiary_id: 3,
        parent_beneficiary_id: 2,
        name_of_farmer: "Leaf Farmer",
        address: "Dawis",
        animal_type: "Carabao",
        sex: "M",
        date_dispersed: "2026-05-01",
        remarks: null,
        generation: 2,
        children: [],
      },
    ],
  },
  {
    event_id: 3,
    beneficiary_id: 4,
    parent_beneficiary_id: 1,
    name_of_farmer: "Second Offspring",
    address: "Nangka",
    animal_type: "Goat",
    sex: "F",
    date_dispersed: null,
    remarks: null,
    generation: 1,
    children: [],
  },
];

describe("GenealogyTree", () => {
  it("renders every generation", () => {
    render(<GenealogyTree nodes={TREE} />);

    expect(screen.getByText("Mid Farmer")).toBeInTheDocument();
    expect(screen.getByText("Leaf Farmer")).toBeInTheDocument();
    expect(screen.getByText("Second Offspring")).toBeInTheDocument();
    expect(screen.getByText("Generation 2")).toBeInTheDocument();
    expect(screen.getAllByText("Generation 1")).toHaveLength(2);
  });

  it("nests deeper generations inside their parent", () => {
    const { container } = render(<GenealogyTree nodes={TREE} />);

    // Exactly one nested list: Leaf Farmer's generation lives under Mid Farmer.
    expect(container.querySelectorAll("ul ul")).toHaveLength(1);
  });

  it("handles a missing date gracefully", () => {
    render(<GenealogyTree nodes={TREE} />);

    expect(screen.getByText(/Date not recorded/)).toBeInTheDocument();
  });

  it("renders nothing for an empty tree", () => {
    const { container } = render(<GenealogyTree nodes={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
