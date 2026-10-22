import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AnimalTypeClassificationSelect } from "../components/AnimalTypeClassificationSelect";

/**
 * The shared cascade behaves like barangay → purok: classification is disabled
 * until a type is picked, its options follow the chosen type, and changing the
 * type clears a classification that no longer belongs to it.
 */

const GROUPS = [
  {
    key: "livestock",
    label: "Livestock",
    animal_types: [
      {
        id: 1,
        name: "Swine (Pig)",
        classifications: [
          { id: 11, name: "Boar" },
          { id: 12, name: "Sow" },
        ],
      },
      {
        id: 2,
        name: "Cattle",
        classifications: [
          { id: 21, name: "Bull" },
          { id: 22, name: "Cow" },
        ],
      },
    ],
  },
  {
    key: "poultry",
    label: "Poultry",
    animal_types: [
      {
        id: 3,
        name: "Chicken",
        classifications: [
          { id: 31, name: "Rooster" },
          { id: 32, name: "Hen" },
        ],
      },
    ],
  },
];

function Harness({ onChangeSpy, extraTypes = [] }) {
  const [value, setValue] = useState({ animalType: "", classificationId: "" });

  return (
    <AnimalTypeClassificationSelect
      groups={GROUPS}
      extraTypes={extraTypes}
      typeValue={value.animalType}
      classificationValue={value.classificationId}
      onChange={(change) => {
        onChangeSpy?.(change);
        setValue(change);
      }}
      typeId="test-type"
      classificationId="test-classification"
    />
  );
}

describe("AnimalTypeClassificationSelect", () => {
  it("groups the types under their main category", () => {
    render(<Harness />);

    expect(screen.getByRole("group", { name: "Livestock" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Poultry" })).toBeInTheDocument();

    const select = screen.getByLabelText("Animal type");
    expect(within(select).getByRole("option", { name: "Swine (Pig)" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Chicken" })).toBeInTheDocument();
  });

  it("keeps classification disabled until a type is chosen, then follows that type", async () => {
    const user = userEvent.setup();
    const changes = [];
    render(<Harness onChangeSpy={(change) => changes.push(change)} />);

    const classification = screen.getByLabelText("Classification");
    expect(classification).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Animal type"), "Swine (Pig)");

    await expect(within(classification).findByRole("option", { name: "Boar" })).resolves.toBeInTheDocument();
    expect(classification).toBeEnabled();
    expect(changes.at(-1)).toEqual({
      animalType: "Swine (Pig)",
      animalTypeId: 1,
      classificationId: "",
    });

    await user.selectOptions(classification, "12");
    expect(changes.at(-1)).toEqual({
      animalType: "Swine (Pig)",
      animalTypeId: 1,
      classificationId: "12",
    });

    // A different type cannot keep the old classification.
    await user.selectOptions(screen.getByLabelText("Animal type"), "Chicken");

    expect(classification).toHaveValue("");
    expect(within(classification).getByRole("option", { name: "Rooster" })).toBeInTheDocument();
    expect(within(classification).queryByRole("option", { name: "Boar" })).not.toBeInTheDocument();
    expect(changes.at(-1)).toEqual({
      animalType: "Chicken",
      animalTypeId: 3,
      classificationId: "",
    });
  });

  it("shows recorded values outside the catalogue instead of dropping them", () => {
    render(<Harness extraTypes={["Bore"]} />);

    expect(
      within(screen.getByLabelText("Animal type")).getByRole("option", { name: "Bore" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Other recorded types" })).toBeInTheDocument();
  });
});
