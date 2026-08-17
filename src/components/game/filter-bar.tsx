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
  const [openMenu, setOpenMenu] = useState<"category" | "difficulty" | null>(null);
  const close = useCallback(() => setOpenMenu(null), []);
  const categoryGroups = useMemo<FilterGroup[]>(() => CATEGORY_GROUPS.map((group) => ({
    label: group.label,
    options: group.categories.map((item) => ({ value: item.id, label: item.label })),
  })), []);
  const difficultyGroups = useMemo<FilterGroup[]>(() => [{
    label: "Difficulty",
    options: DIFFICULTIES.map((item) => ({ value: item, label: DIFFICULTY_LABELS[item] })),
  }], []);

  return (
    <div className="filters" aria-label="Game filters">
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
      <span className="filter-divider" aria-hidden="true" />
      <FilterSelect
        label="Difficulty"
        value={difficulty}
        groups={difficultyGroups}
        open={openMenu === "difficulty"}
        disabled={disabled}
        menuAlign="end"
        onOpen={() => setOpenMenu("difficulty")}
        onClose={close}
        onChange={(nextDifficulty) => onChange({ category, difficulty: nextDifficulty as Difficulty })}
      />
    </div>
  );
}
