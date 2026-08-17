"use client";

import { CATEGORY_GROUPS } from "@/lib/catalog/category-config";
import { DIFFICULTIES, type Difficulty } from "@/types/game";
import { DIFFICULTY_LABELS } from "@/lib/game/difficulty";

export function FilterBar({
  category, difficulty, disabled, onChange,
}: {
  category: string;
  difficulty: Difficulty;
  disabled?: boolean;
  onChange: (filters: { category: string; difficulty: Difficulty }) => void;
}) {
  return (
    <div className="filters" aria-label="Game filters">
      <label>
        <span className="sr-only">Category</span>
        <select value={category} disabled={disabled} onChange={(event) => onChange({ category: event.target.value, difficulty })}>
          {CATEGORY_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <span className="filter-divider" aria-hidden="true" />
      <label>
        <span className="sr-only">Difficulty</span>
        <select value={difficulty} disabled={disabled} onChange={(event) => onChange({ category, difficulty: event.target.value as Difficulty })}>
          {DIFFICULTIES.map((item) => <option key={item} value={item}>{DIFFICULTY_LABELS[item]}</option>)}
        </select>
      </label>
    </div>
  );
}
