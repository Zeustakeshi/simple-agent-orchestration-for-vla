"use client";
/* Switch — one implementation for every on/off control.

   Geometry, because the knob used to sit off-centre: the track is 36×20 with a
   16px knob, so the gap must be 2px on all four sides. `left-0.5` + `top-0.5`
   parks it 2px in, and the ON travel is 36 − 16 − 2 − 2 = 16px (translate-x-4).
   Anchoring with `left` rather than relying on the static position is what
   keeps the two ends symmetric. */

interface SwitchProps {
  checked: boolean;
  onChange: () => void;
  /** Describes what the switch controls — required, this has no visible label. */
  label: string;
  disabled?: boolean;
  /** Shown on hover; also the reason when disabled. */
  title?: string;
}

export function Switch({ checked, onChange, label, disabled = false, title }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onChange}
      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors duration-[120ms] focus-ring cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-arc-500" : "bg-ink-700 ring-1 ring-inset ring-[var(--line)]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full transition-transform duration-[120ms] ${
          checked ? "translate-x-4 bg-white" : "translate-x-0 bg-haze-300"
        }`}
      />
    </button>
  );
}
