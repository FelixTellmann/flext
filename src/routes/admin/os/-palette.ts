// The validated four (spec 19.2), keyed by palette slot so a project keeps its colour from week to week
// whatever its rank. Slot 1 re-steps for dark; the other three hold. Slate and teal failed the validator;
// do not substitute. The status tokens (success, warning, danger) are never series colours — on these
// screens a colour means something, and a stream that happened to be red would read as a problem.
export const PALETTE_SLOTS = [1, 2, 3, 4] as const;

export type PaletteSlot = (typeof PALETTE_SLOTS)[number];

const SLOT_CLASS: Record<PaletteSlot, string> = {
  1: "bg-primary-500 dark:bg-primary-600",
  2: "bg-violet-500",
  3: "bg-emerald-600",
  4: "bg-rose-500",
};

// Anything without a slot: a fifth project, an unmapped Wakapi name, the null-project bucket.
export const OTHER_CLASS = "bg-gray-400";

const isPaletteSlot = (slot: number): slot is PaletteSlot => PALETTE_SLOTS.some((known) => known === slot);

export const paletteClassOf = (slot: number | null): string => {
  if (slot === null || !isPaletteSlot(slot)) {
    return OTHER_CLASS;
  }

  return SLOT_CLASS[slot];
};
