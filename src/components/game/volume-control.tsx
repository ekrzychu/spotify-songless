type VolumeControlProps = {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

export function VolumeControl({ value, disabled, onChange }: VolumeControlProps) {
  const rangeStyle = { "--volume-percent": `${value}%` } as CSSProperties;
  return (
    <label className="volume-control">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3.5 8h3l3.5-2.7v9.4L6.5 12h-3V8Z" />
        {value === 0
          ? <path d="m12.5 8 3.5 4m0-4-3.5 4" />
          : <path d="M12.6 7.3a3.8 3.8 0 0 1 0 5.4M14.8 5.5a6.3 6.3 0 0 1 0 9" />}
      </svg>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        disabled={disabled}
        style={rangeStyle}
        aria-label="Volume"
        aria-valuetext={`${value}%`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
import type { CSSProperties } from "react";
