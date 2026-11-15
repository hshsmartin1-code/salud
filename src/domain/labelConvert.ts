import type { FoodBasis, NutrientMap } from '../db/catalogTypes';
import { scaleNutrients } from './nutrients';
import { formatNumber } from './units';

/**
 * Nutrition-label conversions for custom foods.
 *
 * A label states its values per 100 g, per 100 ml, per serving or per whole package. We keep the
 * printed basis and values untouched (`labelBasis`, `labelNutrients`) and derive the stored basis:
 *  - per 100 g / 100 ml: stored as is;
 *  - per serving or per package WITH a known weight/volume: converted to per 100 g / 100 ml, and the
 *    serving / package become portions;
 *  - per serving WITHOUT a known weight: stored per serving — the food can only be logged in
 *    servings; no grams or density are invented;
 *  - per package without a weight but with an exact servings-per-package count: per serving =
 *    package ÷ servings (explicit, with a warning); otherwise one "serving" is the whole package.
 */
export type LabelBasis = 'serving' | '100g' | '100ml' | 'package';

export interface LabelDraft {
  basis: LabelBasis;
  /** Values exactly as printed for `basis`. Missing key = not stated (never 0). */
  nutrients: NutrientMap;
  servingSize: number | null;
  servingUnit: 'g' | 'ml' | null;
  servingLabel?: string | null;
  servingsPerPackage: number | null;
  servingsPerPackageApprox?: boolean;
  packageSize: number | null;
  packageUnit: 'g' | 'ml' | null;
}

export interface StoredLabelFood {
  basis: FoodBasis;
  nutrients: NutrientMap;
  portions: [string, number][];
  servingSize: number | null;
  servingUnit: 'g' | 'ml' | null;
  servingLabel: string | null;
  warnings: string[];
}

const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const fmt = (n: number) => formatNumber(n, 1);

export function convertLabel(d: LabelDraft): StoredLabelFood {
  const warnings: string[] = [];
  const servingKnown = pos(d.servingSize) && (d.servingUnit === 'g' || d.servingUnit === 'ml');
  let packageSize = pos(d.packageSize) && (d.packageUnit === 'g' || d.packageUnit === 'ml') ? d.packageSize : null;
  let packageUnit = packageSize ? d.packageUnit : null;
  const servings = pos(d.servingsPerPackage) ? d.servingsPerPackage : null;

  // Package weight from serving size × servings, only when both are stated.
  if (!packageSize && servingKnown && servings) {
    packageSize = (d.servingSize as number) * servings;
    packageUnit = d.servingUnit;
    if (d.servingsPerPackageApprox)
      warnings.push(`El envase se estimó en ${fmt(packageSize)} ${packageUnit} a partir de porciones "aproximadas".`);
  }

  const portionsFor = (unit: 'g' | 'ml'): [string, number][] => {
    const out: [string, number][] = [];
    if (servingKnown && d.servingUnit === unit) out.push([d.servingLabel?.trim() || '1 porción', d.servingSize as number]);
    if (packageSize && packageUnit === unit) out.push(['Envase completo', packageSize]);
    return out;
  };

  if (d.basis === '100g' || d.basis === '100ml') {
    const unit = d.basis === '100g' ? 'g' : 'ml';
    if (servingKnown && d.servingUnit !== unit)
      warnings.push(`La porción está en ${d.servingUnit} pero los valores son por 100 ${unit}: no se convierte entre peso y volumen.`);
    return {
      basis: d.basis,
      nutrients: { ...d.nutrients },
      portions: portionsFor(unit),
      servingSize: servingKnown ? (d.servingSize as number) : null,
      servingUnit: servingKnown ? d.servingUnit : null,
      servingLabel: d.servingLabel ?? null,
      warnings,
    };
  }

  if (d.basis === 'serving') {
    if (servingKnown) {
      const unit = d.servingUnit as 'g' | 'ml';
      return {
        basis: unit === 'g' ? '100g' : '100ml',
        nutrients: scaleNutrients(d.nutrients, 100 / (d.servingSize as number)),
        portions: portionsFor(unit),
        servingSize: d.servingSize,
        servingUnit: unit,
        servingLabel: d.servingLabel ?? null,
        warnings,
      };
    }
    warnings.push('Sin peso de la porción: solo se podrá registrar por porciones (no por gramos).');
    return {
      basis: 'serving',
      nutrients: { ...d.nutrients },
      portions: [],
      servingSize: null,
      servingUnit: null,
      servingLabel: d.servingLabel ?? null,
      warnings,
    };
  }

  // basis === 'package'
  if (packageSize && packageUnit) {
    return {
      basis: packageUnit === 'g' ? '100g' : '100ml',
      nutrients: scaleNutrients(d.nutrients, 100 / packageSize),
      portions: portionsFor(packageUnit),
      servingSize: servingKnown ? (d.servingSize as number) : null,
      servingUnit: servingKnown ? d.servingUnit : null,
      servingLabel: d.servingLabel ?? null,
      warnings,
    };
  }
  if (servings && !d.servingsPerPackageApprox) {
    warnings.push(`Valores por porción calculados como envase ÷ ${fmt(servings)} porciones.`);
    return {
      basis: 'serving',
      nutrients: scaleNutrients(d.nutrients, 1 / servings),
      portions: [],
      servingSize: null,
      servingUnit: null,
      servingLabel: d.servingLabel ?? null,
      warnings,
    };
  }
  if (servings && d.servingsPerPackageApprox)
    warnings.push('Las porciones por envase son aproximadas: no se dividen. Se registrará por envase completo.');
  else warnings.push('Sin peso del envase: se registrará por envase completo.');
  return {
    basis: 'serving',
    nutrients: { ...d.nutrients },
    portions: [],
    servingSize: null,
    servingUnit: null,
    servingLabel: 'envase completo',
    warnings,
  };
}

/** Plausibility checks on the printed values (errors block saving; warnings ask for review). */
export function checkLabelDraft(d: LabelDraft): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const n = d.nutrients;
  const has = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
  for (const [code, v] of Object.entries(n)) if (typeof v === 'number' && v < 0) errors.push(`El valor de "${code}" no puede ser negativo`);
  if (!has(n.kcal)) errors.push('Falta la energía (kcal)');
  const ref =
    d.basis === '100g' || d.basis === '100ml'
      ? 100
      : d.basis === 'serving'
        ? pos(d.servingSize)
          ? d.servingSize
          : null
        : pos(d.packageSize)
          ? d.packageSize
          : null;
  const macros = (has(n.protein) ? n.protein : 0) + (has(n.carbs) ? n.carbs : 0) + (has(n.fat) ? n.fat : 0);
  if (ref !== null && macros > ref + 0.05)
    warnings.push(`Proteína + carbohidratos + grasa (${fmt(macros)} g) supera la base de ${fmt(ref)}: revisa la columna elegida.`);
  if (has(n.kcal) && has(n.kj) && Math.abs(n.kj / 4.184 - n.kcal) > Math.max(5, n.kcal * 0.08))
    warnings.push('Las kcal y los kJ no coinciden (1 kcal = 4,184 kJ): revisa si se intercambiaron.');
  if (has(n.kcal) && (has(n.protein) || has(n.carbs) || has(n.fat))) {
    const atw = 4 * (has(n.protein) ? n.protein : 0) + 4 * (has(n.carbs) ? n.carbs : 0) + 9 * (has(n.fat) ? n.fat : 0);
    if (atw > 20 && Math.abs(atw - n.kcal) / atw > 0.25)
      warnings.push(`Las kcal no coinciden con los macronutrientes (esperadas ≈ ${formatNumber(atw, 0)} kcal).`);
  }
  if (has(n.sugars) && has(n.carbs) && n.sugars > n.carbs + 0.05) warnings.push('Los azúcares superan los carbohidratos totales.');
  if (has(n.addedSugars) && has(n.sugars) && n.addedSugars > n.sugars + 0.05) warnings.push('Los azúcares añadidos superan los azúcares totales.');
  if (has(n.satFat) && has(n.fat) && n.satFat > n.fat + 0.05) warnings.push('La grasa saturada supera la grasa total.');
  if (has(n.transFat) && has(n.fat) && n.transFat > n.fat + 0.05) warnings.push('La grasa trans supera la grasa total: ¿estaba en mg?');
  if (has(n.fiber) && has(n.carbs) && n.fiber > n.carbs + 0.05) warnings.push('La fibra supera los carbohidratos totales.');
  if (has(n.carbsAvail) && has(n.carbs) && n.carbsAvail > n.carbs + 0.05) warnings.push('Los carbohidratos disponibles superan los totales.');
  if (has(n.sodium) && ref !== null && n.sodium / 1000 > ref) warnings.push('El sodio parece demasiado alto: ¿estaba en g o en mg?');
  if (d.basis === 'serving' && !pos(d.servingSize) && pos(d.packageSize))
    warnings.push('Hay peso del envase pero no de la porción: si la etiqueta indica el peso de la porción, escríbelo para poder registrar en gramos.');
  return { errors, warnings };
}
