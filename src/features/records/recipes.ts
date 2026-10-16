// Guided recipes (§9): predefined feature lists per part type, so records are consistent.
import type { FeatureKind, PartRecord, ToolId } from '../../core/types';

export type RecipeId = NonNullable<PartRecord['recipe']>;

export interface RecipeStep {
  /** Feature kinds that satisfy this step. */
  kinds: FeatureKind[];
  /** Label prefix used when the step is measured from the recipe (e.g. "k" for head height). */
  prefix?: string;
  nameKey: string;
  tool: ToolId;
  init?: Record<string, unknown>;
  /** Phase in which the dedicated tool arrives (step shown but disabled until then). */
  phase?: number;
}

export const RECIPES: Record<Exclude<RecipeId, 'custom'>, RecipeStep[]> = {
  bolt: [
    { kinds: ['length'], prefix: 'L', nameKey: 'recipe.step.boltLength', tool: 'ruler' },
    { kinds: ['diameter', 'outerDiameter'], nameKey: 'recipe.step.shank', tool: 'caliper' },
    { kinds: ['acrossFlats'], nameKey: 'recipe.step.af', tool: 'hex' },
    { kinds: ['length'], prefix: 'k', nameKey: 'recipe.step.headHeight', tool: 'ruler' },
    { kinds: ['pitch'], nameKey: 'recipe.step.pitch', tool: 'threadGauge' },
  ],
  nut: [
    { kinds: ['acrossFlats'], nameKey: 'recipe.step.af', tool: 'hex' },
    { kinds: ['innerDiameter', 'diameter'], nameKey: 'recipe.step.bore', tool: 'circle' },
    { kinds: ['length'], prefix: 'm', nameKey: 'recipe.step.nutHeight', tool: 'ruler' },
  ],
  oring: [
    {
      kinds: ['innerDiameter'],
      nameKey: 'recipe.step.id',
      tool: 'circle',
      init: { mode: 'ring', preset: 'oring' },
    },
    {
      kinds: ['crossSection'],
      nameKey: 'recipe.step.cs',
      tool: 'circle',
      init: { mode: 'ring', preset: 'oring' },
    },
  ],
  washer: [
    {
      kinds: ['innerDiameter'],
      nameKey: 'recipe.step.id',
      tool: 'circle',
      init: { mode: 'ring', preset: 'washer' },
    },
    {
      kinds: ['outerDiameter'],
      nameKey: 'recipe.step.od',
      tool: 'circle',
      init: { mode: 'ring', preset: 'washer' },
    },
  ],
  gasket: [
    { kinds: ['outerDiameter'], nameKey: 'recipe.step.od', tool: 'circle', init: { mode: 'ring' } },
    { kinds: ['innerDiameter'], nameKey: 'recipe.step.id', tool: 'circle', init: { mode: 'ring' } },
    { kinds: ['pcd'], nameKey: 'recipe.step.pcd', tool: 'gasket' },
  ],
  rect: [
    { kinds: ['length'], nameKey: 'recipe.step.length', tool: 'box' },
    { kinds: ['width'], nameKey: 'recipe.step.width', tool: 'box' },
  ],
};

/** Which steps of a record's recipe are done (a matching measurement exists). */
export function recipeProgress(r: PartRecord): { step: RecipeStep; done: boolean }[] {
  if (!r.recipe || r.recipe === 'custom') return [];
  const steps = RECIPES[r.recipe];
  const used = new Set<string>();
  return steps.map((step) => {
    const m = r.measurements.find(
      (x) =>
        !used.has(x.id) && step.kinds.includes(x.kind) && (!step.prefix || x.label.startsWith(step.prefix)),
    );
    if (m) used.add(m.id);
    return { step, done: !!m };
  });
}
