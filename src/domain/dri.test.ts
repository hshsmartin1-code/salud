import { describe, expect, it } from 'vitest';
import { ageGroupFor, evaluateAmdr, evaluateIntake, getDri } from './dri';

const on = '2026-11-24';
const male = (birthDate: string | null, energyKcal?: number) => getDri({ sex: 'male', birthDate, on, energyKcal });
const female = (birthDate: string | null, energyKcal?: number) => getDri({ sex: 'female', birthDate, on, energyKcal });

describe('age groups', () => {
  it('maps completed years to groups', () => {
    expect([13, 14, 18, 19, 30, 31, 50, 51, 70, 71, 90].map((a) => ageGroupFor(a))).toEqual([
      null, '14-18', '14-18', '19-30', '19-30', '31-50', '31-50', '51-70', '51-70', '>70', '>70',
    ]);
  });

  it('changes group on the exact birthday (local dates), not the day before', () => {
    expect(female('2007-11-25')?.ageGroup).toBe('14-18'); // 18 until 2026-11-25
    expect(female('2007-11-24')?.ageGroup).toBe('19-30'); // turns 19 today
    expect(female('2007-11-25')?.age).toBe(18);
    expect(female('1995-11-25')?.ageGroup).toBe('19-30'); // 30, turns 31 tomorrow
    expect(female('1995-11-24')?.ageGroup).toBe('31-50'); // turns 31 today
    expect(female('1975-11-25')?.ageGroup).toBe('31-50'); // 50
    expect(female('1975-11-24')?.ageGroup).toBe('51-70'); // turns 51 today
    expect(female('1955-11-25')?.ageGroup).toBe('51-70'); // 70
    expect(female('1955-11-24')?.ageGroup).toBe('>70'); // turns 71 today
  });

  it('is out of scope under 14 years', () => {
    const d = male('2015-01-01');
    expect(d.outOfScope).toBe(true);
    expect(d.refs.iron.kind).toBe('none');
  });
});

describe('sex and age differences', () => {
  it('iron: women 19-50 need 18 mg, men 8 mg, women 51+ drop to 8 mg', () => {
    expect(female('1990-01-01').refs.iron.value).toBe(18);
    expect(male('1990-01-01').refs.iron.value).toBe(8);
    expect(female('1970-01-01').refs.iron.value).toBe(8);
  });

  it('calcium: women 51-70 need 1200 mg, men 1000 mg', () => {
    expect(female('1970-06-01').refs.calcium.value).toBe(1200);
    expect(male('1970-06-01').refs.calcium.value).toBe(1000);
  });

  it('2019 update: sodium CDRR 2300 with AI 1500; potassium AI 3400 men / 2600 women', () => {
    const f = female('1990-01-01');
    expect(f.refs.sodium.kind).toBe('CDRR');
    expect(f.refs.sodium.value).toBe(2300);
    expect(f.referenceSet).toBe('nasem');
    expect(f.refs.sodium.alt).toEqual({ label: 'AI', value: 1500 });
    expect(f.refs.potassium.value).toBe(2600);
    expect(male('1990-01-01').refs.potassium.value).toBe(3400);
  });

  it('vitamin D rises to 20 µg after 70', () => {
    expect(male('1990-01-01').refs.vitD.value).toBe(15);
    expect(male('1950-01-01').refs.vitD.value).toBe(20);
  });

  it('AMDR for 14-18 uses 25-35 % fat and 10-30 % protein', () => {
    expect(female('2010-01-01').amdr).toEqual({ protein: [10, 30], carbs: [45, 65], fat: [25, 35] });
    expect(female('1990-01-01').amdr).toEqual({ protein: [10, 35], carbs: [45, 65], fat: [20, 35] });
  });
});

describe('fiber', () => {
  it('derives 14 g per 1000 kcal from the energy goal and keeps the absolute AI', () => {
    const f = female('1990-01-01', 2000);
    expect(f.refs.fiber.value).toBe(28);
    expect(f.refs.fiber.alt).toEqual({ label: 'AI absoluta', value: 25 });
  });

  it('absolute AI by sex and age without a goal', () => {
    expect(female('1990-01-01').refs.fiber.value).toBe(25);
    expect(male('1990-01-01').refs.fiber.value).toBe(38);
    expect(male('1960-01-01').refs.fiber.value).toBe(30);
    expect(female('1960-01-01').refs.fiber.value).toBe(21);
  });
});

describe('limits in % of energy and notes', () => {
  it('saturated fat and added sugars: under 10 % of energy', () => {
    const d = female('1990-01-01');
    expect(d.refs.satFat.pctEnergyMax).toBe(10);
    const ok = evaluateIntake(d.refs.satFat, 20, 9.9);
    expect(ok.text).toBe('99 % del límite');
    expect(ok.tone).toBe('good');
    const bad = evaluateIntake(d.refs.addedSugars, 60, 10.5);
    expect(bad.text).toBe('Por encima del límite');
    expect(bad.tone).toBe('bad');
  });

  it('trans fat and cholesterol have no numeric reference, stated in the note', () => {
    const d = female('1990-01-01');
    expect(d.refs.transFat.kind).toBe('none');
    expect(d.refs.transFat.note).toMatch(/más bajo posible/);
    expect(d.refs.cholesterol.kind).toBe('none');
    expect(evaluateIntake(d.refs.cholesterol, 200).text).toBe('Sin referencia');
  });

  it('UL that applies only to supplements is not flagged for food intake', () => {
    const d = female('1990-01-01');
    expect(d.refs.magnesium.ulSupplementOnly).toBe(true);
    const s = evaluateIntake(d.refs.magnesium, 900);
    expect(s.overUl).toBe(false);
    expect(s.text).toBe('281 %');
    // A UL for total intake is flagged.
    expect(evaluateIntake(d.refs.zinc, 60).text).toBe('Por encima del UL');
  });

  it('unknown intake is "Sin dato", never zero', () => {
    expect(evaluateIntake(female('1990-01-01').refs.iron, null).text).toBe('Sin dato');
  });

  it('food water is informational', () => {
    expect(evaluateIntake(female('1990-01-01').refs.water, 1200).text).toBe('Informativo');
    expect(female('1990-01-01').refs.water.value).toBe(2700);
  });

  it('sodium above the CDRR is flagged, below it reports the share', () => {
    const r = male('1990-01-01').refs.sodium;
    expect(evaluateIntake(r, 2500).text).toBe('Por encima del CDRR');
    expect(evaluateIntake(r, 1150).text).toBe('50 % del CDRR');
  });

  it('AMDR classification', () => {
    expect(evaluateAmdr(9, [10, 35])).toBe('below');
    expect(evaluateAmdr(10, [10, 35])).toBe('within');
    expect(evaluateAmdr(35, [10, 35])).toBe('within');
    expect(evaluateAmdr(36, [10, 35])).toBe('above');
  });
});

describe('missing profile data', () => {
  it('unknown sex shows ranges, no point value and asks to complete the profile', () => {
    const d = getDri({ sex: null, birthDate: '1990-01-01', on });
    expect(d.refs.iron.value).toBeNull();
    expect(d.refs.iron.range).toEqual([8, 18]);
    expect(d.refs.vitB12.value).toBe(2.4); // same for both sexes
    expect(d.notes.join(' ')).toMatch(/sexo/);
    expect(evaluateIntake(d.refs.iron, 10).tone).toBe('muted');
    expect(evaluateIntake(d.refs.iron, 10).text).toBe('Falta el sexo en el perfil');
  });

  it('missing birth date assumes adult 31-50 and says so', () => {
    const d = female(null);
    expect(d.ageAssumed).toBe(true);
    expect(d.ageGroup).toBe('31-50');
    expect(d.refs.iron.value).toBe(18);
    expect(d.notes.join(' ')).toMatch(/31 a 50/);
  });

  it('invalid birth date is treated as missing', () => {
    expect(female('no-es-fecha').ageAssumed).toBe(true);
  });
});
