type VolumeControlProps = {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

export function VolumeControl({ value, disabled, onChange }: VolumeControlProps) {
  return (
    <label className="volume-control">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3 8h3l4-3v10l-4-3H3V8Zm10.2-.8a4 4 0 0 1 0 5.6M15.4 5a7 7 0 0 1 0 10" />
      </svg>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        disabled={disabled}
        aria-label="Volume"
        aria-valuetext={`${value}%`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span aria-hidden="true">{value}</span>
    </label>
  );
}
