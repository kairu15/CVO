import { CIRCLE_MODES } from "../lib/mapCircles";

/**
 * Segmented control for the public map's marker display.
 *
 * Three modes, one active at a time, announced with `aria-pressed` so a
 * screen reader reads "Whole, toggle button, pressed". It is a plain button
 * group (no roving tabindex) because there are only three options and every
 * one is reachable with Tab — the map beneath keeps its own keyboard access.
 *
 * Kept presentational: the caller owns the active mode, so the same control
 * can drive any circle map later without this component knowing about maps.
 *
 * @param {object} props
 * @param {string} props.value active CIRCLE_MODES id
 * @param {(mode: string) => void} [props.onChange]
 * @param {Array<{id: string, label: string, hint?: string}>} [props.modes]
 * @param {string} [props.label] group label for assistive tech
 * @param {string} [props.className]
 */
export function MapModeSwitch({
  value,
  onChange,
  modes = CIRCLE_MODES,
  label = "Map marker display",
  className = "",
}) {
  return (
    <div role="group" aria-label={label} className={`cvo-mode-switch ${className}`.trim()}>
      {modes.map((mode) => {
        const active = mode.id === value;
        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={active}
            title={mode.hint}
            onClick={() => onChange?.(mode.id)}
            className={`cvo-mode-switch__button${active ? " cvo-mode-switch__button--active" : ""}`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

export default MapModeSwitch;
