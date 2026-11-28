// The DepEd grade computation, as the teacher types.
// Keep this in step with backend/src/utils/deped.js — same bands, same formula.
// PS = (encoded scores / highest possible of the ENCODED columns only) * 100,
// except Examinations under DO 015, where the PS is the sub-weighted mean of
// the column PS values (Summative Test 1 30%, Summative Test 2 30%, Term Exam
// 40%). A blank cell is not a zero: it is left out of both totals until the
// teacher encodes it.
//
// A "grading profile" is the grading system in force for one academic year:
//   do8_2015         — DO 8, s. 2015: 4 quarters, WW/PT/QA, transmutation
//                       where an initial grade of 60 becomes 75.
//   do015_adjusted   — DO 015, s. 2026, SY 2026-2027: 3 terms, WW/PT/EX,
//                       the adjusted transmutation table where an initial
//                       grade of 70 becomes 75.
//   do015_zero_based — DO 015, s. 2026, from SY 2027-2028: 3 terms, WW/PT/EX,
//                       NO transmutation — the term grade is the initial
//                       grade itself, rounded to a whole number.

export type GradingProfileCode = 'do8_2015' | 'do015_adjusted' | 'do015_zero_based';
export type SubjectGroup = 'core' | 'mapeh' | 'epp_tle';
export type GradeComponent = 'WW' | 'PT' | 'EX';

export interface GradeProfile {
  code: GradingProfileCode;
  label: string;
  periods: number[];
  periodLabel: string;
  periodShort: string;
  gradeLabel: string;
  thirdLabel: string;
  thirdShort: string;
  transmutation: 'do8' | 'do015_adjusted' | 'none';
  honors: 'do8' | 'do015';
  weights: Record<SubjectGroup, { ww: number; pt: number; ex: number }>;
  // Lowest grade that can appear on the card under this profile: 60
  // where a transmutation table bottoms out at 60, 0 where there is none.
  floor: number;
}

export const PROFILES: Record<GradingProfileCode, GradeProfile> = {
  do8_2015: {
    code: 'do8_2015',
    label: 'DO 8 · s. 2015',
    periods: [1, 2, 3, 4],
    periodLabel: 'Quarter',
    periodShort: 'Q',
    gradeLabel: 'Quarterly grade',
    thirdLabel: 'Quarterly Assessment',
    thirdShort: 'QA',
    transmutation: 'do8',
    honors: 'do8',
    floor: 60,
    weights: {
      core: { ww: 30, pt: 50, ex: 20 },
      mapeh: { ww: 30, pt: 50, ex: 20 },
      epp_tle: { ww: 30, pt: 50, ex: 20 },
    },
  },
  do015_adjusted: {
    code: 'do015_adjusted',
    label: 'DO 015 · Adjusted',
    periods: [1, 2, 3],
    periodLabel: 'Term',
    periodShort: 'T',
    gradeLabel: 'Term grade',
    thirdLabel: 'Examinations',
    thirdShort: 'EX',
    transmutation: 'do015_adjusted',
    honors: 'do015',
    floor: 60,
    weights: {
      core: { ww: 20, pt: 50, ex: 30 },
      mapeh: { ww: 20, pt: 60, ex: 20 },
      epp_tle: { ww: 20, pt: 60, ex: 20 },
    },
  },
  do015_zero_based: {
    code: 'do015_zero_based',
    label: 'DO 015 · Zero-based',
    periods: [1, 2, 3],
    periodLabel: 'Term',
    periodShort: 'T',
    gradeLabel: 'Term grade',
    thirdLabel: 'Examinations',
    thirdShort: 'EX',
    transmutation: 'none',
    honors: 'do015',
    floor: 0,
    weights: {
      core: { ww: 20, pt: 50, ex: 30 },
      mapeh: { ww: 20, pt: 60, ex: 20 },
      epp_tle: { ww: 20, pt: 60, ex: 20 },
    },
  },
};

export function profileFor(code: string | null | undefined): GradeProfile {
  return PROFILES[(code as GradingProfileCode) || 'do8_2015'] || PROFILES['do8_2015'];
}

export function profileLabel(code: string | null | undefined, academicYear?: string | null): string {
  const profile = profileFor(code);
  return academicYear ? `${profile.label} · SY ${academicYear}` : profile.label;
}

export interface GradeColumnLike {
  id: number;
  component: GradeComponent;
  highest_possible: number;
  sub_weight?: number | null;
  label?: string | null;
  position?: number;
  name?: string;
}

export interface ComponentGrade {
  total: number;
  maxTotal: number;
  ps: number | null;
  ws: number | null;
  entered: number;
  count: number;
}

export interface ComputedGrade {
  components: Record<GradeComponent, ComponentGrade>;
  complete: boolean;
  entered: number;
  cells: number;
  initial: number | null;
  qg: number | null; // the grade on the card: the term grade under DO 015, the quarterly grade under DO 8
  descriptor: string | null;
  status: string;
}

// DepEd Order No. 8, s. 2015, Appendix B transmutation table.
// [lowest initial grade in the band, transmuted grade], highest first.
export const TRANSMUTATION_BANDS: [number, number][] = [
  [100, 100], [98.4, 99], [96.8, 98], [95.2, 97], [93.6, 96], [92, 95], [90.4, 94],
  [88.8, 93], [87.2, 92], [85.6, 91], [84, 90], [82.4, 89], [80.8, 88], [79.2, 87],
  [77.6, 86], [76, 85], [74.4, 84], [72.8, 83], [71.2, 82], [69.6, 81], [68, 80],
  [66.4, 79], [64.8, 78], [63.2, 77], [61.6, 76], [60, 75], [56, 74], [52, 73],
  [48, 72], [44, 71], [40, 70], [36, 69], [32, 68], [28, 67], [24, 66], [20, 65],
  [16, 64], [12, 63], [8, 62], [4, 61], [0, 60],
];

// DO 015, s. 2026, Annex D Table 4 — the ADJUSTED table, SY 2026-2027 only.
// [lowest initial grade in the band, transmuted grade], highest first.
export const DO015_ADJUSTED_BANDS: [number, number][] = [
  [99.5, 100], [98.32, 99], [97.14, 98], [95.96, 97], [94.78, 96],
  [93.6, 95], [92.42, 94], [91.24, 93], [90.06, 92], [88.88, 91],
  [87.7, 90], [86.52, 89], [85.34, 88], [84.16, 87], [82.98, 86],
  [81.8, 85], [80.62, 84], [79.44, 83], [78.26, 82], [77.08, 81],
  [75.9, 80], [74.72, 79], [73.54, 78], [72.36, 77], [71.18, 76],
  [70, 75], [65.34, 74], [60.67, 73], [56.01, 72], [51.34, 71],
  [46.67, 70], [42.01, 69], [37.34, 68], [32.68, 67], [28.01, 66],
  [23.35, 65], [18.68, 64], [14.01, 63], [9.35, 62], [4.68, 61],
  [0, 60],
];

export const DEFAULT_WEIGHTS = { ww: 30, pt: 50, ex: 20 };

export interface DefaultColumn {
  component: GradeComponent;
  highest_possible: number;
  sub_weight: number | null;
  label: string | null;
}

export function defaultColumns(profileCode: string | null | undefined): DefaultColumn[] {
  const profile = profileFor(profileCode);
  const columns: DefaultColumn[] = [];
  for (let i = 0; i < 4; i++) {
    columns.push({ component: 'WW', highest_possible: 25, sub_weight: null, label: null });
  }
  for (let i = 0; i < 4; i++) {
    columns.push({ component: 'PT', highest_possible: 50, sub_weight: null, label: null });
  }
  if (profile.code === 'do8_2015') {
    columns.push({ component: 'EX', highest_possible: 50, sub_weight: null, label: null });
  } else {
    columns.push(
      { component: 'EX', highest_possible: 50, sub_weight: 30, label: 'Summative Test 1' },
      { component: 'EX', highest_possible: 50, sub_weight: 30, label: 'Summative Test 2' },
      { component: 'EX', highest_possible: 50, sub_weight: 40, label: 'Term Exam' },
    );
  }
  return columns;
}

export const DEFAULT_COLUMNS: { component: GradeComponent; name: string; highest_possible: number }[] = [
  { component: 'WW', name: 'WW1', highest_possible: 25 },
  { component: 'WW', name: 'WW2', highest_possible: 25 },
  { component: 'WW', name: 'WW3', highest_possible: 25 },
  { component: 'WW', name: 'WW4', highest_possible: 25 },
  { component: 'PT', name: 'PT1', highest_possible: 50 },
  { component: 'PT', name: 'PT2', highest_possible: 50 },
  { component: 'PT', name: 'PT3', highest_possible: 50 },
  { component: 'PT', name: 'PT4', highest_possible: 50 },
  { component: 'EX', name: 'EX1', highest_possible: 50 },
];

export function defaultWeights(
  profileCode: string | null | undefined,
  subjectGroup: string | null | undefined = 'core',
): { ww: number; pt: number; ex: number } {
  const profile = profileFor(profileCode);
  const group: SubjectGroup =
    subjectGroup === 'mapeh' || subjectGroup === 'epp_tle' ? subjectGroup : 'core';
  return { ...profile.weights[group] };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The lowest grade that can appear on the card under a profile, before any teacher-set floor. */
export function defaultFloor(profileCode: string | null | undefined = 'do8_2015'): number {
  return profileFor(profileCode).floor;
}

/** The grade on the card for an initial grade, under a profile, or null when not yet computed.
 *  `floor` is the lowest grade that may appear: the teacher-set floor, or the
 *  profile's own floor when none was set. It is a minimum only, so under
 *  DO 8 / DO 015 Adjusted a floor below 60 changes nothing — the table
 *  already bottoms out at 60. */
export function transmute(
  initial: number | null,
  profileCode: string | null | undefined = 'do8_2015',
  floor: number | null | undefined = null,
): number | null {
  if (initial === null || initial === undefined) return null;
  const profile = profileFor(profileCode);
  const clamped = Math.min(100, Math.max(0, round2(initial)));
  const effectiveFloor = floor === null || floor === undefined ? profile.floor : Math.min(100, Math.max(0, floor));
  if (profile.transmutation === 'none') return Math.max(Math.round(clamped), effectiveFloor);
  const bands = profile.transmutation === 'do015_adjusted' ? DO015_ADJUSTED_BANDS : TRANSMUTATION_BANDS;
  for (const [lowest, transmuted] of bands) {
    if (clamped >= lowest) return Math.max(transmuted, effectiveFloor);
  }
  return Math.max(bands[bands.length - 1][1], effectiveFloor);
}

export function descriptorFor(grade: number, profileCode: string | null | undefined = 'do8_2015'): string {
  const profile = profileFor(profileCode);
  if (profile.transmutation === 'do8') {
    if (grade >= 90) return 'Outstanding';
    if (grade >= 85) return 'Very Satisfactory';
    if (grade >= 80) return 'Satisfactory';
    if (grade >= 75) return 'Fairly Satisfactory';
    return 'Did Not Meet Expectations';
  }
  if (grade >= 90) return 'Advancing';
  if (grade >= 80) return 'Benchmarking';
  if (grade >= 75) return 'Connecting';
  if (grade >= 65) return 'Developing';
  return 'Emerging';
}

/** Final grade across the year's periods: the mean of the period grades, rounded to a whole number. */
export function finalGrade(periodGrades: (number | null | undefined)[]): number | null {
  if (!periodGrades || periodGrades.length === 0) return null;
  if (periodGrades.some((grade) => grade === null || grade === undefined)) return null;
  return Math.round(
    (periodGrades as number[]).reduce((sum, grade) => sum + grade, 0) / periodGrades.length,
  );
}

export function computeLearnerGrade(
  columns: GradeColumnLike[],
  scores: Map<number, number | null>,
  weights: { ww: number; pt: number; ex: number; floor?: number | null },
  profileCode: string | null | undefined = 'do8_2015',
  floor: number | null | undefined = null,
): ComputedGrade {
  const profile = profileFor(profileCode);
  const effectiveFloor =
    floor !== null && floor !== undefined
      ? floor
      : weights.floor !== null && weights.floor !== undefined
        ? weights.floor
        : profile.floor;
  const components: Record<GradeComponent, ComponentGrade> = {
    WW: { total: 0, maxTotal: 0, ps: null, ws: null, entered: 0, count: 0 },
    PT: { total: 0, maxTotal: 0, ps: null, ws: null, entered: 0, count: 0 },
    EX: { total: 0, maxTotal: 0, ps: null, ws: null, entered: 0, count: 0 },
  };

  const weightFor: Record<GradeComponent, number> = {
    WW: weights.ww,
    PT: weights.pt,
    EX: weights.ex,
  };

  let complete = true;
  let entered = 0;
  let cells = 0;
  for (const key of ['WW', 'PT', 'EX'] as GradeComponent[]) {
    const component = components[key];
    const group = columns.filter((column) => column.component === key);
    if (group.length === 0) complete = false;
    const encoded: { column: GradeColumnLike; score: number }[] = [];
    for (const column of group) {
      component.count += 1;
      cells += 1;
      const score = scores.get(column.id);
      if (score === null || score === undefined) {
        complete = false;
        continue;
      }
      component.entered += 1;
      entered += 1;
      component.total += score;
      component.maxTotal += column.highest_possible;
      encoded.push({ column, score });
    }
    if (encoded.length > 0) {
      if (key === 'EX' && profile.transmutation !== 'do8') {
        // Examinations under DO 015: the sub-weighted mean of each column's PS.
        const totalWeight = encoded.reduce((sum, entry) => sum + (Number(entry.column.sub_weight) || 0), 0);
        if (totalWeight > 0) {
          component.ps = round2(
            encoded.reduce(
              (sum, entry) =>
                sum +
                (entry.score / entry.column.highest_possible) * 100 * (Number(entry.column.sub_weight) || 0),
              0,
            ) / totalWeight,
          );
        } else {
          component.ps = round2(
            encoded.reduce((sum, entry) => sum + (entry.score / entry.column.highest_possible) * 100, 0) /
              encoded.length,
          );
        }
      } else {
        component.ps = round2((component.total / component.maxTotal) * 100);
      }
      component.ws = round2((component.ps * weightFor[key]) / 100);
    }
  }

  let initial: number | null = null;
  if (['WW', 'PT', 'EX'].every((key) => components[key as GradeComponent].ps !== null)) {
    initial = round2(
      (['WW', 'PT', 'EX'] as GradeComponent[]).reduce(
        (sum, key) => sum + (components[key].ws as number),
        0,
      ),
    );
  }

  const qg = complete && initial !== null ? transmute(initial, profileCode, effectiveFloor) : null;
  const status = !complete
    ? 'Incomplete'
    : qg !== null && qg < 75
      ? 'Complete · Below 75'
      : 'Complete · Passed';

  return {
    components,
    complete,
    entered,
    cells,
    initial,
    qg,
    descriptor: qg === null ? null : descriptorFor(qg, profileCode),
    status,
  };
}

// The weighted score of each Examinations sub-column, for the DepEd class
// record printout (WS ST1 / WS ST2 / WS TE). This mirrors the EX branch of
// computeLearnerGrade above: each encoded column's PS times its share of
// the component — its sub-weight, or an equal share when no encoded column
// has one. The shares add up to the component PS. Unencoded columns get
// null. Under DO 8 there is no sub-column breakdown (a single QA column),
// so callers only use this when the profile is a DO 015 one.
export function exSubWs(
  columns: GradeColumnLike[],
  scores: Map<number, number | null>,
  profileCode: string | null | undefined = 'do8_2015',
): Map<number, number | null> {
  const result = new Map<number, number | null>();
  if (profileFor(profileCode).transmutation === 'do8') return result;
  const group = columns.filter((column) => column.component === 'EX');
  const encoded = group.filter((column) => {
    const score = scores.get(column.id);
    return score !== null && score !== undefined;
  });
  const totalWeight = encoded.reduce((sum, column) => sum + (Number(column.sub_weight) || 0), 0);
  for (const column of group) {
    const score = scores.get(column.id);
    if (score === null || score === undefined) {
      result.set(column.id, null);
      continue;
    }
    const share = totalWeight > 0 ? Number(column.sub_weight) || 0 : 100 / encoded.length;
    result.set(column.id, round2(((score / column.highest_possible) * 100 * share) / 100));
  }
  return result;
}

export function honorsFor(
  gwa: number | null,
  subjectGrades: (number | null | undefined)[] | null = null,
  profileCode: string | null | undefined = 'do8_2015',
): string | null {
  if (gwa === null || gwa === undefined) return null;
  const profile = profileFor(profileCode);
  if (profile.honors === 'do015') {
    const grades = (subjectGrades || []).filter(
      (grade): grade is number => grade !== null && grade !== undefined,
    );
    if (grades.length === 0) return null;
    if (gwa >= 90 && grades.every((grade) => grade >= 80)) return 'Academic Excellence Award';
    return null;
  }
  if (gwa >= 98) return 'With Highest Honors';
  if (gwa >= 95) return 'With High Honors';
  if (gwa >= 90) return 'With Honors';
  return null;
}
