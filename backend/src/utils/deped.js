'use strict';

// DepEd grade computation, in one place so the Grades page and Academic
// Consolidation can never disagree.
//
// A "grading profile" is the grading system in force for one academic year,
// chosen by an admin in Settings and stored in grading_profiles:
//   do8_2015         — DO 8, s. 2015: 4 quarters, WW/PT/QA, the transmutation
//                       table where an initial grade of 60 becomes 75.
//   do015_adjusted   — DO 015, s. 2026, SY 2026-2027: 3 terms, WW/PT/EX
//                       (Examinations), the adjusted transmutation table
//                       where an initial grade of 70 becomes 75.
//   do015_zero_based — DO 015, s. 2026, from SY 2027-2028: 3 terms, WW/PT/EX,
//                       NO transmutation — the term grade is the initial
//                       grade itself, rounded to a whole number.
//
// The floor is the lowest grade that can appear on the card. Each profile
// has its own: 60 under DO 8 and under DO 015 Adjusted (both tables bottom
// out at 60 — an initial grade of 0 transmutes to 60), 0 under zero-based
// (a 0 stays a 0). A teacher can raise the floor for one class in the
// weights section of the Grades page; a set floor is a minimum only, so it
// never lowers a grade below what the profile's table gives.
//
// The steps, per learner per period (a quarter under DO 8, a term under
// DO 015):
//   1. Per component (Written Works, Performance Tasks, Examinations or
//        Quarterly Assessment):
//        PS = (sum of encoded scores / sum of highest possible for ENCODED columns) * 100
//      — except Examinations under DO 015, where the PS is the sub-weighted
//      mean of the column PS values (Summative Test 1 30%, Summative Test 2
//      30%, Term Exam 40%). A column only counts once the learner has a
//      score in it. A learner with no encoded score in a component has no
//      PS for it yet (null, shown as —, never 0). That is a deliberate
//      choice: a partial record shows the grade so far, and the final grade
//      is only fixed once every cell is filled — at that point the
//      denominator is every column, exactly as DepEd computes it.
//   2. WS = PS * weight / 100. The weights are per class (default under
//      DO 015: core 20 / 50 / 30, MAPEH and EPP/TLE 20 / 60 / 20; under
//      DO 8: 30 / 50 / 20).
//   3. Initial grade = WS(WW) + WS(PT) + WS(EX), once every component has a PS.
//   4. Term grade (quarterly grade under DO 8) = the initial grade run
//      through the profile's table — or, zero-based, the initial grade
//      itself. It is only set once the record is complete (every cell
//      filled); a grade of 75 or higher passes.
//
// Grades are computed live from scores and are never stored. A filed
// submission keeps the profile it was filed under, so switching a year's
// profile never recomputes a filed grade.
//
// The frontend keeps a mirror of this file in src/app/core/deped.ts so
// scores update live while the teacher types. The two must stay in step;
// the API is authoritative whenever a sheet is loaded or saved.

// ---------------------------------------------------------------- profiles
// A period is a quarter under DO 8 and a term under DO 015. The code calls
// it "quarter" everywhere (the database column is grade_columns.quarter);
// the profile says how many periods the year has and what to call them.
const PROFILES = {
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
    // Default weights do not depend on the subject group under DO 8.
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
    // DO 015 Table 9: core 20/50/30, MAPEH and EPP/TLE 20/60/20.
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

const PROFILE_CODES = Object.keys(PROFILES);

// Default profile for a year that has no row in grading_profiles yet:
// this year (2026-2027) runs on DO 015 adjusted; from 2027-2028 the order
// says zero-based; anything earlier is DO 8.
function defaultProfileForYear(academicYear) {
  if (academicYear === '2026-2027') return 'do015_adjusted';
  const start = parseInt(String(academicYear || '').slice(0, 4), 10);
  if (!Number.isNaN(start) && start >= 2027) return 'do015_zero_based';
  return 'do8_2015';
}

function profileFor(code) {
  return PROFILES[code] || PROFILES.do8_2015;
}

// Short plain-words label for the UI, e.g. "DO 015 · Adjusted · SY 2026-2027".
function profileLabel(code, academicYear) {
  return academicYear
    ? `${profileFor(code).label} · SY ${academicYear}`
    : profileFor(code).label;
}

// ------------------------------------------------------------ transmutation
// Each table is a list of [lowest initial grade, transmuted grade] pairs,
// ordered from the top down. A band is read as "from this lower bound up to
// the next band's lower bound".
//
// DO 8, s. 2015, Appendix B: an initial grade of 60 is the lowest that can
// pass (60 -> 75). Above 60 the bands are 1.6 wide; below 60 they are
// 4 wide (56.00-59.99 earns 74, ..., 0-3.99 earns 60), so the lowest grade
// that can appear on a card is 60.
const DO8_BANDS = [
  [100, 100],
  [98.4, 99],
  [96.8, 98],
  [95.2, 97],
  [93.6, 96],
  [92, 95],
  [90.4, 94],
  [88.8, 93],
  [87.2, 92],
  [85.6, 91],
  [84, 90],
  [82.4, 89],
  [80.8, 88],
  [79.2, 87],
  [77.6, 86],
  [76, 85],
  [74.4, 84],
  [72.8, 83],
  [71.2, 82],
  [69.6, 81],
  [68, 80],
  [66.4, 79],
  [64.8, 78],
  [63.2, 77],
  [61.6, 76],
  [60, 75],
  [56, 74],
  [52, 73],
  [48, 72],
  [44, 71],
  [40, 70],
  [36, 69],
  [32, 68],
  [28, 67],
  [24, 66],
  [20, 65],
  [16, 64],
  [12, 63],
  [8, 62],
  [4, 61],
  [0, 60],
];

// DO 015, s. 2026, Annex D Table 4 — the ADJUSTED table, used only in
// SY 2026-2027. Transcribed from the order's table: an initial grade of 70
// becomes 75, and 60 is the lowest grade on the report card even for an
// initial grade of 0. Bands above 70 are 1.18 wide; below 70 they are about
// 4.67 wide. The first entry covers 99.50 to 100.00. Cross-checked band for
// band against two independent explainers of the order (see the Batch 4.1
// build log in GOAL.md for the sources).
const DO015_ADJUSTED_BANDS = [
  [99.50, 100], [98.32, 99], [97.14, 98], [95.96, 97], [94.78, 96],
  [93.60, 95], [92.42, 94], [91.24, 93], [90.06, 92], [88.88, 91],
  [87.70, 90], [86.52, 89], [85.34, 88], [84.16, 87], [82.98, 86],
  [81.80, 85], [80.62, 84], [79.44, 83], [78.26, 82], [77.08, 81],
  [75.90, 80], [74.72, 79], [73.54, 78], [72.36, 77], [71.18, 76],
  [70.00, 75], [65.34, 74], [60.67, 73], [56.01, 72], [51.34, 71],
  [46.67, 70], [42.01, 69], [37.34, 68], [32.68, 67], [28.01, 66],
  [23.35, 65], [18.68, 64], [14.01, 63], [9.35, 62], [4.68, 61],
  [0.00, 60],
];

const COMPONENTS = ['WW', 'PT', 'EX'];

// The weights a class starts with under DO 8 (the Batch 4 default).
const DEFAULT_WEIGHTS = { ww: 30, pt: 50, ex: 20 };

// Two decimals, so 59.9999999 from floating-point maths never transmutes as 59.99.
function round2(value) {
  return Math.round(value * 100) / 100;
}

// An initial grade (0-100) becomes the grade on the card, under a profile.
// Zero-based: the term grade IS the initial grade, rounded to a whole
// number. The order sets no floor for zero-based — a 0 stays a 0 — so none
// is applied here (see the Batch 4.1 build log for the source check).
// `floor` is the lowest grade that may appear: a teacher-set floor in the
// weights section, or the profile's own floor when none was set. It is a
// minimum only — Math.max — so under DO 8 / DO 015 Adjusted a floor below
// 60 changes nothing, because the table already bottoms out at 60.
function transmute(initialGrade, profileCode = 'do8_2015', floor = null) {
  if (initialGrade === null || initialGrade === undefined) return null;
  const profile = profileFor(profileCode);
  const grade = Math.min(100, Math.max(0, round2(Number(initialGrade))));
  const effectiveFloor = floor === null || floor === undefined ? profile.floor : Math.min(100, Math.max(0, Number(floor)));
  if (profile.transmutation === 'none') return Math.max(Math.round(grade), effectiveFloor);
  const bands = profile.transmutation === 'do015_adjusted' ? DO015_ADJUSTED_BANDS : DO8_BANDS;
  for (const [lower, transmuted] of bands) {
    if (grade >= lower) return Math.max(transmuted, effectiveFloor);
  }
  return Math.max(bands[bands.length - 1][1], effectiveFloor);
}

// The lowest grade that can appear on the card under a profile, before
// any teacher-set floor for a class.
function defaultFloor(profileCode = 'do8_2015') {
  return profileFor(profileCode).floor;
}

// ------------------------------------------------------------------- weights
// Default columns for a class the first time a period is opened.
// Under DO 015 the Examinations columns are Summative Test 1 (30%),
// Summative Test 2 (30%) and Term Exam (40%) of the component. Under DO 8
// the third component is a single Quarterly Assessment column.
function defaultColumns(profileCode = 'do8_2015') {
  const columns = [];
  for (let i = 0; i < 4; i++) {
    columns.push({ component: 'WW', highest_possible: 25, sub_weight: null, label: null });
  }
  for (let i = 0; i < 4; i++) {
    columns.push({ component: 'PT', highest_possible: 50, sub_weight: null, label: null });
  }
  if (profileFor(profileCode).code === 'do8_2015') {
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

const DEFAULT_COLUMNS = defaultColumns('do8_2015');

// The default weights for a class, by profile and subject group.
function defaultWeights(profileCode = 'do8_2015', subjectGroup = 'core') {
  const profile = profileFor(profileCode);
  const group = subjectGroup === 'mapeh' || subjectGroup === 'epp_tle' ? subjectGroup : 'core';
  return { ...profile.weights[group] };
}

// ------------------------------------------------------------------ helpers
// Display name of a column: its label when set, otherwise its component
// prefix and position (WW1, PT2, EX1 — or QA1 under DO 8).
function columnName(column, profileCode = 'do8_2015') {
  if (column.label) return column.label;
  const profile = profileFor(profileCode);
  const prefix = column.component === 'EX' ? profile.thirdShort : column.component;
  return `${prefix}${column.position}`;
}

// ------------------------------------------------------------- grade result
// One learner's grade for one class and period.
// columns: [{ id, component, highest_possible, sub_weight, label }] for the period.
// scores: a Map of column id -> score (number), or null when not encoded.
// weights: { ww, pt, ex } and, when the teacher set one for the class,
// floor: the lowest grade that may appear (otherwise the profile's own).
// profileCode: which grading system applies.
// The result keeps the Batch 4 shape: { components, complete, entered,
// cells, initial, qg, status }, plus descriptor once the grade is set.
// qg is the grade on the card — the term grade under DO 015, the quarterly
// grade under DO 8.
function computeLearnerGrade(columns, scores, weights, profileCode = 'do8_2015', floor = null) {
  const profile = profileFor(profileCode);
  const effectiveFloor = floor !== null && floor !== undefined
    ? floor
    : weights && weights.floor !== null && weights.floor !== undefined
      ? weights.floor
      : profile.floor;
  const result = { components: {}, complete: true, entered: 0, cells: 0, initial: null, qg: null, descriptor: null, status: 'Incomplete' };

  for (const component of COMPONENTS) {
    const group = columns.filter((column) => column.component === component);
    let total = 0;
    let maxTotal = 0;
    let entered = 0;
    if (group.length === 0) result.complete = false; // a component with no columns cannot be complete
    const encoded = [];
    for (const column of group) {
      result.cells += 1;
      const score = scores.get(column.id);
      if (score === null || score === undefined) {
        result.complete = false;
        continue;
      }
      total += score;
      maxTotal += Number(column.highest_possible);
      entered += 1;
      result.entered += 1;
      encoded.push({ column, score });
    }
    let ps = null;
    if (entered > 0) {
      if (component === 'EX' && profile.transmutation !== 'do8') {
        // Examinations under DO 015: the sub-weighted mean of each column's
        // PS. A column with no sub-weight (made under DO 8, before the
        // switch) counts as 0; when no encoded column has a sub-weight at
        // all, the columns share equally.
        const totalWeight = encoded.reduce((sum, entry) => sum + (Number(entry.column.sub_weight) || 0), 0);
        if (totalWeight > 0) {
          ps = encoded.reduce(
            (sum, entry) => sum + (entry.score / Number(entry.column.highest_possible)) * 100 * (Number(entry.column.sub_weight) || 0),
            0
          ) / totalWeight;
        } else {
          ps = encoded.reduce((sum, entry) => sum + (entry.score / Number(entry.column.highest_possible)) * 100, 0) / encoded.length;
        }
      } else {
        // WW, PT, and Quarterly Assessment under DO 8 pool all encoded scores.
        ps = (total / maxTotal) * 100;
      }
    }
    const weight = weights[component.toLowerCase()];
    result.components[component] = {
      total,
      maxTotal,
      ps: ps === null ? null : round2(ps),
      ws: ps === null ? null : round2((ps * weight) / 100),
      entered,
      count: group.length,
    };
  }

  const allHavePs = COMPONENTS.every((component) => result.components[component].ps !== null);
  if (allHavePs) {
    result.initial = round2(
      COMPONENTS.reduce((sum, component) => sum + result.components[component].ws, 0)
    );
  }
  if (result.complete && result.initial !== null) {
    result.qg = transmute(result.initial, profileCode, effectiveFloor);
    result.descriptor = descriptorFor(result.qg, profileCode);
    result.status = result.qg >= 75 ? 'Complete · Passed' : 'Complete · Below 75';
  }
  return result;
}

// The five summary numbers for a class record, from the computed grades.
// learners: [{ id, computed }] where computed is computeLearnerGrade's result.
function computeClassStats(learners) {
  const complete = learners.filter((learner) => learner.computed.complete);
  const passed = complete.filter((learner) => learner.computed.qg >= 75);
  const entered = learners.reduce((sum, learner) => sum + learner.computed.entered, 0);
  const cells = learners.reduce((sum, learner) => sum + learner.computed.cells, 0);
  return {
    mps: complete.length === 0
      ? null
      : round2(complete.reduce((sum, learner) => sum + learner.computed.initial, 0) / complete.length),
    passing_rate: complete.length === 0 ? null : round2((passed.length / complete.length) * 100),
    passing_count: passed.length,
    complete_count: complete.length,
    total_learners: learners.length,
    highest_transmuted: complete.length === 0
      ? null
      : Math.max(...complete.map((learner) => learner.computed.qg)),
    intervention_count: complete.filter((learner) => learner.computed.qg < 75).length,
    // The names of the complete records below 75, for the intervention list.
    intervention: complete
      .filter((learner) => learner.computed.qg < 75)
      .map((learner) => `${learner.last_name}, ${learner.first_name}`),
    encoding_pct: cells === 0 ? 0 : Math.round((entered / cells) * 100),
    entered,
    cells,
  };
}

// Performance descriptor for a grade on the card. DO 015 Table 11 for the
// DO 015 profiles; the DO 8 descriptors for the DO 8 profile.
function descriptorFor(grade, profileCode = 'do8_2015') {
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

// The descriptor table printed on the report card, per profile.
// DO 015 Table 11 for the DO 015 profiles; the DO 8 descriptors for DO 8.
function descriptorTable(profileCode = 'do8_2015') {
  const profile = profileFor(profileCode);
  if (profile.transmutation === 'do8') {
    return [
      { range: '90–100', descriptor: 'Outstanding', remarks: 'Passed' },
      { range: '85–89', descriptor: 'Very Satisfactory', remarks: 'Passed' },
      { range: '80–84', descriptor: 'Satisfactory', remarks: 'Passed' },
      { range: '75–79', descriptor: 'Fairly Satisfactory', remarks: 'Passed' },
      { range: 'Below 75', descriptor: 'Did Not Meet Expectations', remarks: 'Failed' },
    ];
  }
  return [
    { range: '90–100', descriptor: 'Advancing', remarks: 'Passed' },
    { range: '80–89', descriptor: 'Benchmarking', remarks: 'Passed' },
    { range: '75–79', descriptor: 'Connecting', remarks: 'Passed' },
    { range: '65–74', descriptor: 'Developing', remarks: 'Failed' },
    { range: '0–64', descriptor: 'Emerging', remarks: 'Failed' },
  ];
}

// Final grade for one subject across the year's periods: the mean of the
// period grades, rounded to the nearest whole number. Returns null when
// any period grade is missing (the final grade needs every period filed).
function finalGrade(periodGrades) {
  if (!periodGrades || periodGrades.length === 0) return null;
  if (periodGrades.some((grade) => grade === null || grade === undefined)) return null;
  return Math.round(periodGrades.reduce((sum, grade) => sum + grade, 0) / periodGrades.length);
}

// ------------------------------------------------------------------- honors
// DO 015 (from SY 2026-2027): the Academic Excellence Award — general
// average of 90 or higher and no grade below 80. (The order also requires
// no disciplinary case during the school year; discipline is not recorded
// in AcadSync, so that part is the school's to check.)
// DO 8 (DO 36, s. 2016): With Honors 90-94, With High Honors 95-97,
// With Highest Honors 98-100.
// subjectGrades is the list of the learner's grades the award is judged on
// (the term grades for a term view, the final grades for the final view).
function honorsFor(gwa, subjectGrades = null, profileCode = 'do8_2015') {
  if (gwa === null || gwa === undefined) return null;
  const profile = profileFor(profileCode);
  if (profile.honors === 'do015') {
    const grades = Array.isArray(subjectGrades)
      ? subjectGrades.filter((grade) => grade !== null && grade !== undefined)
      : [];
    if (grades.length === 0) return null;
    if (gwa >= 90 && grades.every((grade) => grade >= 80)) return 'Academic Excellence Award';
    return null;
  }
  if (gwa >= 98) return 'With Highest Honors';
  if (gwa >= 95) return 'With High Honors';
  if (gwa >= 90) return 'With Honors';
  return null;
}

module.exports = {
  PROFILES,
  PROFILE_CODES,
  defaultProfileForYear,
  profileFor,
  profileLabel,
  DO8_BANDS,
  DO015_ADJUSTED_BANDS,
  TRANSMUTATION_BANDS: DO8_BANDS,
  COMPONENTS,
  DEFAULT_WEIGHTS,
  DEFAULT_COLUMNS,
  round2,
  transmute,
  defaultFloor,
  defaultColumns,
  defaultWeights,
  columnName,
  computeLearnerGrade,
  computeClassStats,
  descriptorFor,
  descriptorTable,
  finalGrade,
  honorsFor,
};
