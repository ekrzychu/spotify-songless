"use client";

import { useCallback, useMemo, useState } from "react";
import { CATEGORY_GROUPS } from "@/lib/catalog/category-config";
import { DIFFICULTIES, type Difficulty } from "@/types/game";
import { DIFFICULTY_LABELS } from "@/lib/game/difficulty";
import { FilterSelect, type FilterGroup } from "@/components/game/filter-select";

export function FilterBar({
  category, difficulty, disabled, onChange,
}: {
  category: string;
  difficulty: Difficulty;
  disabled?: boolean;
  onChange: (filters: { category: string; difficulty: Difficulty }) => void;
}) {
  const [openMenu, setOpenMenu] = useState<"category" | null>(null);
  const close = useCallback(() => setOpenMenu(null), []);
  const categoryGroups = useMemo<FilterGroup[]>(() => CATEGORY_GROUPS.map((group) => ({
    label: group.label,
    options: group.categories.map((item) => ({ value: item.id, label: item.label })),
  })), []);
  return (
    <aside className="filters" aria-label="Game filters">
      <section className="filter-section">
        <h2 className="rail-heading">Category</h2>
        <FilterSelect
          label="Category"
          value={category}
          groups={categoryGroups}
          open={openMenu === "category"}
          disabled={disabled}
          onOpen={() => setOpenMenu("category")}
          onClose={close}
          onChange={(nextCategory) => onChange({ category: nextCategory, difficulty })}
        />
      </section>
      <section className="filter-section filter-section--difficulty">
        <h2 className="rail-heading" id="difficulty-heading">Difficulty</h2>
        <div className="difficulty-options" role="group" aria-labelledby="difficulty-heading">
          {DIFFICULTIES.map((item) => (
            <button
              className="difficulty-option"
              type="button"
              aria-pressed={item === difficulty}
              disabled={disabled}
              key={item}
              onClick={() => {
                close();
                if (item !== difficulty) onChange({ category, difficulty: item });
              }}
            >
              <span>{DIFFICULTY_LABELS[item]}</span>
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
