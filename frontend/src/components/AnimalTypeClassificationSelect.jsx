import { useMemo } from "react";

/**
 * The shared Animal Type → Classification cascade.
 *
 * One component, used by the beneficiary form, the monitoring filter and the
 * settings screen's previews, so the three surfaces cannot drift apart. It
 * mirrors the barangay → purok cascade: the classification control stays
 * DISABLED until a type is chosen, and changing the type clears the previous
 * classification (a Boar under Swine is not a Boar under Goat).
 *
 * The type options are grouped under their main-category header — Livestock,
 * Poultry, Other Farm Animals — so the dropdown reads as the office's list
 * instead of 35 unsorted species. `extraTypes` carries values actually present
 * in the data but missing from the catalogue (an older import, a typo): they
 * are shown last under "Other recorded types" rather than silently dropped,
 * which is what keeps historical records filterable.
 *
 * @param {object} props
 * @param {Array<{key: string, label: string, animal_types: Array<object>}>} [props.groups]
 * @param {string[]} [props.extraTypes] data-derived names outside the catalogue
 * @param {string} [props.typeValue] selected type name
 * @param {string|number} [props.classificationValue] selected classification id
 * @param {(change: {animalType: string, animalTypeId: number|null, classificationId: string}) => void} props.onChange
 * @param {boolean} [props.allowAll] adds the "All …" options (filters)
 * @param {boolean} [props.disabled]
 * @param {string} [props.typeLabel]
 * @param {string} [props.classificationLabel]
 * @param {string} [props.typeAriaLabel] overrides the accessible name
 * @param {string} [props.classificationAriaLabel]
 * @param {string} [props.typeId]
 * @param {string} [props.classificationId]
 * @param {string} [props.typeError]
 * @param {string} [props.classificationError]
 * @param {string} [props.className] wrapper class (grid layout differs per screen)
 */
export function AnimalTypeClassificationSelect({
  groups = [],
  extraTypes = [],
  typeValue = "",
  classificationValue = "",
  onChange,
  allowAll = false,
  disabled = false,
  typeLabel = "Animal type",
  classificationLabel = "Classification",
  typeAriaLabel,
  classificationAriaLabel,
  typeId = "animal-type",
  classificationId = "animal-classification",
  typeError,
  classificationError,
  className = "",
}) {
  const catalogTypes = useMemo(
    () => groups.flatMap((group) => group.animal_types ?? []),
    [groups],
  );

  // A value present in the data but absent from the catalogue still has to be
  // selectable — otherwise editing a historical household would silently
  // change its animal type on save.
  const extras = useMemo(() => {
    const known = new Set(catalogTypes.map((type) => type.name.toLowerCase()));

    return [...new Set(extraTypes.filter((name) => name && !known.has(String(name).toLowerCase())))];
  }, [catalogTypes, extraTypes]);

  const selectedType = useMemo(() => {
    const key = typeValue.trim().toLowerCase();

    return (
      catalogTypes.find((type) => type.name.toLowerCase() === key) ??
      // Legacy short forms: "Swine" for "Swine (Pig)".
      catalogTypes.find((type) => type.name.toLowerCase().startsWith(`${key} (`)) ??
      null
    );
  }, [catalogTypes, typeValue]);

  const classifications = selectedType?.classifications ?? [];
  const hasAnyType = catalogTypes.length > 0 || extras.length > 0;

  function chooseType(event) {
    const name = event.target.value;
    const type = catalogTypes.find((entry) => entry.name === name);

    onChange?.({
      animalType: name,
      animalTypeId: type?.id ?? null,
      // A new type invalidates the old classification — always.
      classificationId: "",
    });
  }

  function chooseClassification(event) {
    onChange?.({
      animalType: typeValue,
      animalTypeId: selectedType?.id ?? null,
      classificationId: event.target.value,
    });
  }

  return (
    <div className={className}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor={typeId}
            className="block text-sm font-medium text-slate-700"
          >
            {typeLabel}
          </label>
          <select
            id={typeId}
            className="field mt-1.5"
            value={typeValue}
            onChange={chooseType}
            disabled={disabled || !hasAnyType}
            aria-label={typeAriaLabel}
          >
            <option value="">
              {allowAll ? "All animal types" : "Select animal type…"}
            </option>

            {groups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {(group.animal_types ?? []).map((type) => (
                  <option key={type.id} value={type.name}>
                    {type.name}
                  </option>
                ))}
              </optgroup>
            ))}

            {extras.length > 0 && (
              <optgroup label="Other recorded types">
                {extras.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {typeError && (
            <p className="mt-1.5 text-xs font-medium text-red-600">{typeError}</p>
          )}
        </div>

        <div>
          <label
            htmlFor={classificationId}
            className="block text-sm font-medium text-slate-700"
          >
            {classificationLabel}
          </label>
          <select
            id={classificationId}
            className="field mt-1.5"
            value={classificationValue}
            onChange={chooseClassification}
            disabled={disabled || !selectedType || classifications.length === 0}
            aria-label={classificationAriaLabel}
          >
            <option value="">
              {selectedType === null
                ? "Choose an animal type first"
                : classifications.length === 0
                  ? "No classifications for this type"
                  : allowAll
                    ? "All classifications"
                    : "Select classification…"}
            </option>
            {classifications.map((classification) => (
              <option key={classification.id} value={classification.id}>
                {classification.name}
              </option>
            ))}
          </select>
          {classificationError && (
            <p className="mt-1.5 text-xs font-medium text-red-600">
              {classificationError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
