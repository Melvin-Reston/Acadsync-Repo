'use strict';

// The grading system in force for one academic year, read from the database.
// A year keeps its own profile (grading_profiles), so switching next year's
// system never rewrites this year's grades. Grades are computed live from
// scores, never stored — and a filed submission keeps the profile it was
// filed under (grade_submissions.profile), so a switch can never recompute
// a filed grade.
const db = require('../db');
const deped = require('./deped');
const { badRequest } = require('./httpError');

// The profile for a year: the stored row, or the default for that year when
// no row exists yet (a year created before Batch 4.1, or a new year).
async function getGradingProfile(client, academicYear) {
  const result = await client.query(
    'SELECT profile FROM grading_profiles WHERE academic_year = $1',
    [academicYear]
  );
  const code = result.rows[0] ? result.rows[0].profile : deped.defaultProfileForYear(academicYear);
  const profile = deped.profileFor(code);
  return { code: profile.code, academic_year: academicYear, ...profile };
}

// The profile info the API sends to the browser: everything the pages need
// to say which system is active, in plain words.
function gradingInfo(profile, academicYear) {
  return {
    code: profile.code,
    label: deped.profileLabel(profile.code, academicYear),
    period_label: profile.periodLabel,
    period_short: profile.periodShort,
    periods: profile.periods,
    grade_label: profile.gradeLabel,
    third_label: profile.thirdLabel,
    third_short: profile.thirdShort,
    default_floor: deped.defaultFloor(profile.code),
  };
}

// The profile a class record uses: the profile of the class's own academic
// year, so a class from last year keeps last year's system even after the
// admin switches this year's.
async function getClassGradingProfile(client, classId) {
  const result = await client.query('SELECT academic_year FROM classes WHERE id = $1', [classId]);
  const year = result.rows[0] ? result.rows[0].academic_year : null;
  return getGradingProfile(client, year);
}

// A switch is refused while any grade has been filed for that year: the
// filed grades were computed under the old system, and changing the system
// underneath them would make the Grades page and Consolidation disagree
// about the same filing. To change the system, file nothing for the year
// yet — or, for a year that already has filings, the admin changes the
// system only by filing the next period under the new system (each
// submission keeps its own profile).
async function assertSwitchAllowed(client, academicYear) {
  const result = await client.query(
    'SELECT COUNT(*)::int AS count FROM grade_submissions WHERE academic_year = $1',
    [academicYear]
  );
  // Manual grades filed by an adviser count the same way: they were filed
  // under the profile frozen on the manual subject, and switching the
  // year's system underneath them would make the frozen and current
  // systems disagree about the same year.
  const manual = await client.query(
    `SELECT COUNT(*)::int AS count FROM manual_subject_grades g
       JOIN manual_subjects s ON s.id = g.manual_subject_id
      WHERE s.academic_year = $1`,
    [academicYear]
  );
  if (result.rows[0].count > 0 || manual.rows[0].count > 0) {
    throw badRequest(
      `Grades have already been filed for ${academicYear}, so the grading system for that year cannot be changed.`,
      {
        errors: {
          profile:
            'Grades already filed for this year keep the system they were filed under. Change the system for the next academic year instead.',
        },
      }
    );
  }
}

// The profile of the academic year the settings say is current.
async function getCurrentGradingProfile(client = db) {
  const result = await client.query("SELECT value FROM settings WHERE key = 'academic_year'");
  const year = result.rows[0] ? result.rows[0].value : null;
  return getGradingProfile(client, year);
}

module.exports = {
  getGradingProfile,
  gradingInfo,
  getClassGradingProfile,
  assertSwitchAllowed,
  getCurrentGradingProfile,
};
