// Report Card (DepEd School Form 9): one card per learner in the signed-in
// teacher's advisory section. Everything on the card comes from real data —
// the consolidated grades for the Learning Progress table, the Batch 3
// attendance records for the back of the card — except the teacher's comment
// per learner per period, which is the only thing typed on the card and the
// only thing saved here.
//
// The grades are never recomputed a second way: the period grades come from
// the same computeSubjectPeriodGrades the Consolidation uses, under the
// profile each period was filed under, and the final grade and descriptors
// come from the shared DepEd helper. A period or a subject with no filed
// grade shows —, never an invented number.
const db = require('../db');
const { badRequest, notFound } = require('../utils/httpError');
const deped = require('../utils/deped');
const grading = require('../utils/grading');
const {
  adviserOf,
  sectionClasses,
  sectionRoster,
  computeSubjectPeriodGrades,
  academicYear,
  resolveViewingYear,
  loadManualSubjects,
  attachManualSubjects,
  manualPeriodGrades,
  manualHasGrades,
} = require('./grades.controller');

const MONTH_LABELS = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];

// The school year's months, June to April: SY 2026-2027 runs Jun 2026–Apr 2027.
function schoolYearMonths(year) {
  const start = parseInt(String(year || '').slice(0, 4), 10);
  const months = [];
  for (let i = 0; i < 11; i++) {
    const month = 6 + i; // June (6) through April (16 = next April)
    const y = start + Math.floor((month - 1) / 12);
    const m = ((month - 1) % 12) + 1;
    months.push({ key: `${y}-${String(m).padStart(2, '0')}`, label: MONTH_LABELS[i] });
  }
  return months;
}

// One day's status from every mark the learner has that day, across the
// section's classes: present when they were marked present or late in at
// least one class (they were at school that day), otherwise excused when
// excused in at least one class, otherwise absent.
function dayStatus(statuses) {
  if (statuses.includes('present') || statuses.includes('late')) return 'present';
  if (statuses.includes('excused')) return 'excused';
  return 'absent';
}

// Completed years of age on June 1 of the school year's first year: the
// age the card prints for the year, stable across the year and across
// viewing years (a past year's card shows the age the learner was then,
// not today). A learner with no birthdate on file has no age.
function ageOnJune1(birthdate, year) {
  if (!birthdate) return null;
  const startYear = parseInt(String(year || '').slice(0, 4), 10);
  if (!Number.isFinite(startYear)) return null;
  const born = new Date(`${birthdate}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let age = startYear - born.getUTCFullYear();
  // The birthday counts for this year only when it falls on or before June 1.
  if (born.getUTCMonth() > 5 || (born.getUTCMonth() === 5 && born.getUTCDate() > 1)) age -= 1;
  return age < 0 ? 0 : age;
}

// The whole card set for one advisory section: the school name for the
// printed card, the section's subjects (filed or not), each learner's period
// grades, final grades and general average, the attendance months, and the
// saved teacher's comments.
async function buildReportCards(client, adviser, requestedYear) {
  const year = requestedYear || (await academicYear(client));
  const profile = await grading.getGradingProfile(client, year);
  const classes = await sectionClasses(client, adviser, year);
  const classIds = classes.map((klass) => klass.id);
  const roster = await sectionRoster(client, adviser, classIds);
  const months = schoolYearMonths(year);

  const school = await client.query('SELECT name, principal_contact, seal_path FROM schools WHERE id = $1', [adviser.school_id]);
  const schoolName = school.rows[0] ? school.rows[0].name : '';
  // The School Head's printed name comes from the school's own record
  // (its Principal / contact field), not from the teacher's profile.
  const schoolHeadName = school.rows[0] ? school.rows[0].principal_contact || '' : '';
  // Whether the school has uploaded a seal (Dashboard): the image itself
  // is fetched from its own endpoint, never as a path in this response.
  const hasSchoolSeal = Boolean(school.rows[0] && school.rows[0].seal_path);

  // Every filing for the section's classes this year, by class and period.
  const submissions = new Map(); // class id -> Map(period -> { submitted_at, profile })
  if (classIds.length > 0) {
    const submitted = await client.query(
      `SELECT class_id, quarter, submitted_at, profile FROM grade_submissions
        WHERE class_id = ANY($1::int[]) AND academic_year = $2`,
      [classIds, year]
    );
    for (const row of submitted.rows) {
      if (!submissions.has(row.class_id)) submissions.set(row.class_id, new Map());
      submissions.get(row.class_id).set(row.quarter, { submitted_at: row.submitted_at, profile: row.profile });
    }
  }

  // One entry per subject name, in consolidation order. When two teachers
  // teach the same subject to the section, the first filed class carries
  // the grades; the card names both teachers. Manual subjects (Batch 8
  // fix 10) merge in by name the same way: a real filing wins a period,
  // the manual grades fill periods with no real submission.
  const subjectEntries = [];
  {
    const byName = new Map();
    for (const klass of classes) {
      const key = klass.subject_name.trim().toLowerCase();
      let subject = byName.get(key);
      if (!subject) {
        subject = { subject_name: klass.subject_name, teacher_names: [], class_ids: [] };
        byName.set(key, subject);
        subjectEntries.push(subject);
      }
      subject.teacher_names.push(`${klass.teacher_last_name}, ${klass.teacher_first_name}`);
      subject.class_ids.push(klass.id);
    }
  }
  attachManualSubjects(subjectEntries, await loadManualSubjects(client, adviser, year));

  // The period grades for each subject, per learner. Every subject taught
  // to the section appears on the card, even when no grade has been filed
  // for it yet — its cells stay blank until a filing arrives, so the card
  // already names the learning areas the learner is taking.
  const subjectCards = []; // { subject_name, teacher_name, grades: Map(roster key -> [qg per period]) }
  for (const subject of subjectEntries) {
    const key = subject.subject_name.trim().toLowerCase();
    const periodGradesByPeriod = new Map(); // period -> Map(roster key -> qg or null)
    for (const period of profile.periods) {
      const filedClassId = subject.class_ids.find(
        (classId) => submissions.has(classId) && submissions.get(classId).has(period)
      );
      // A real filed submission takes precedence for the period; the
      // manual grades fill periods with no real submission.
      if (filedClassId !== undefined) {
        const submission = submissions.get(filedClassId).get(period);
        periodGradesByPeriod.set(
          period,
          await computeSubjectPeriodGrades(client, filedClassId, period, submission.profile, roster)
        );
      } else if (subject.manual && manualHasGrades(subject.manual, period)) {
        periodGradesByPeriod.set(period, manualPeriodGrades(subject.manual, period, roster));
      }
    }
    const grades = new Map(); // roster key -> [qg per period, in profile order]
    for (const rosterKey of roster.keys()) {
      grades.set(
        rosterKey,
        profile.periods.map((period) => periodGradesByPeriod.get(period)?.get(rosterKey) ?? null)
      );
    }
    subjectCards.push({
      subject_name: subject.subject_name,
      teacher_name: subject.teacher_names.join(' · '),
      manual: subject.manual !== null,
      grades,
    });
  }

  // Attendance: every mark for the learner in the section's classes, in the
  // school year. A learner's row in another teacher's class carries a
  // different learner id (the database id), so marks are matched to the
  // roster through the enrolment map, not by the row alone.
  const pkToRosterKey = new Map(); // learner database id -> roster key
  for (const [rosterKey, learner] of roster) {
    for (const learnerPk of learner.byClass.values()) pkToRosterKey.set(learnerPk, rosterKey);
  }
  const daysByLearner = new Map(); // roster key -> Map(date -> [statuses])
  if (classIds.length > 0) {
    const firstDay = `${months[0].key}-01`;
    const lastMonth = months[months.length - 1].key.split('-');
    const afterLast = new Date(Number(lastMonth[0]), Number(lastMonth[1]), 1);
    const afterLastKey = `${afterLast.getFullYear()}-${String(afterLast.getMonth() + 1).padStart(2, '0')}-01`;
    const marks = await client.query(
      `SELECT learner_id, date::text AS date, status FROM attendance
        WHERE class_id = ANY($1::int[]) AND date >= $2 AND date < $3`,
      [classIds, firstDay, afterLastKey]
    );
    for (const row of marks.rows) {
      const rosterKey = pkToRosterKey.get(row.learner_id);
      if (!rosterKey) continue;
      if (!daysByLearner.has(rosterKey)) daysByLearner.set(rosterKey, new Map());
      const days = daysByLearner.get(rosterKey);
      if (!days.has(row.date)) days.set(row.date, []);
      days.get(row.date).push(row.status);
    }
  }

  // The saved comments, matched to the roster by the school learner ID, so
  // a comment follows the learner even when the row it was saved against is
  // no longer the one on the roster.
  const commentsByLearner = new Map(); // roster key -> { period: comment }
  if (roster.size > 0) {
    const rosterKeys = [...roster.keys()];
    const saved = await client.query(
      `SELECT LOWER(TRIM(l.learner_id)) AS roster_key, rc.period, rc.comment
         FROM report_card_comments rc
         JOIN learners l ON l.id = rc.learner_id
        WHERE rc.academic_year = $1 AND LOWER(TRIM(l.learner_id)) = ANY($2::text[])`,
      [year, rosterKeys]
    );
    for (const row of saved.rows) {
      if (!commentsByLearner.has(row.roster_key)) commentsByLearner.set(row.roster_key, {});
      commentsByLearner.get(row.roster_key)[row.period] = row.comment;
    }
  }

  const learners = [...roster.values()].map((learner) => {
    const key = String(learner.learner_id).trim().toLowerCase();
    const subjects = subjectCards.map((subject) => {
      const periodGrades = subject.grades.get(key) ?? profile.periods.map(() => null);
      const finalGrade = deped.finalGrade(periodGrades);
      return {
        subject_name: subject.subject_name,
        period_grades: periodGrades,
        final_grade: finalGrade,
        remarks: finalGrade === null ? null : finalGrade >= 75 ? 'Passed' : 'Failed',
      };
    });
    // The general average is the mean of the final grades, rounded to a
    // whole number like the final grades. It only appears once every subject
    // on the card has a final grade — until then it shows —.
    const finals = subjects.map((subject) => subject.final_grade);
    const generalAverage =
      finals.length === 0 || finals.some((grade) => grade === null)
        ? null
        : Math.round(finals.reduce((sum, grade) => sum + grade, 0) / finals.length);

    // Attendance by month: a month with no records shows — (null), and the
    // totals are null when the learner has no records at all this year.
    const days = daysByLearner.get(key) || new Map();
    const monthsOut = {};
    const totals = { class_days: 0, present: 0, absent: 0, excused: 0 };
    let hasAny = false;
    for (const month of months) {
      let present = 0;
      let absent = 0;
      let excused = 0;
      for (const [date, statuses] of days) {
        if (!date.startsWith(month.key)) continue;
        const status = dayStatus(statuses);
        if (status === 'present') present += 1;
        else if (status === 'excused') excused += 1;
        else absent += 1;
      }
      const classDays = present + absent + excused;
      if (classDays === 0) {
        monthsOut[month.key] = null;
      } else {
        hasAny = true;
        monthsOut[month.key] = { class_days: classDays, present, absent, excused };
        totals.class_days += classDays;
        totals.present += present;
        totals.absent += absent;
        totals.excused += excused;
      }
    }

    return {
      first_name: learner.first_name,
      last_name: learner.last_name,
      learner_id: learner.learner_id,
      sex: learner.sex,
      age: ageOnJune1(learner.birthdate, year),
      subjects,
      general_average: generalAverage,
      general_average_remarks:
        generalAverage === null ? null : generalAverage >= 75 ? 'Passed' : 'Failed',
      attendance: { months: monthsOut, totals: hasAny ? totals : null },
      comments: commentsByLearner.get(key) || {},
    };
  });

  return {
    has_advisory: true,
    adviser: {
      grade: adviser.advisory_grade,
      section: adviser.advisory_section,
      name: `${adviser.last_name}, ${adviser.first_name}`,
    },
    school_name: schoolName,
    school_head_name: schoolHeadName,
    has_school_seal: hasSchoolSeal,
    academic_year: year,
    grading: grading.gradingInfo(profile, year),
    descriptors: deped.descriptorTable(profile.code),
    months,
    subjects: subjectCards.map((subject) => ({
      subject_name: subject.subject_name,
      teacher_name: subject.teacher_name,
    })),
    learners,
  };
}

// GET /api/teacher/report-card?academic_year= — the cards for the adviser's section, for the year viewed.
async function getReportCards(req, res) {
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  res.json(await buildReportCards(db, adviser, await resolveViewingYear(req)));
}

// PUT /api/teacher/report-card/comments  { learner_id, period, comment }
// Saves the teacher's comment for one learner and period. A blank comment
// clears the saved one. Only the adviser of the learner's section can save
// a comment for that learner.
async function saveComment(req, res) {
  const { learner_id, period, comment } = req.valid.body;
  const adviser = await adviserOf(db, req.teacher.id);
  if (!adviser) {
    throw badRequest('Set your advisory assignment on the Dashboard first.', {
      code: 'NO_ADVISORY',
      errors: { advisory_section: 'Choose an advisory grade and section on the Dashboard.' },
    });
  }
  // The comment belongs to the year being viewed, sent in the body, so a
  // past year's comment never overwrites this year's.
  const year = req.valid.body.academic_year || (await academicYear());
  const profile = await grading.getGradingProfile(db, year);
  if (!profile.periods.includes(period)) {
    throw badRequest(
      `${profile.periodLabel} ${period} does not exist under ${profile.label}. This year has ${profile.periodLabel}s ${profile.periods.join(', ')}.`,
      { errors: { period: `Choose ${profile.periodLabel.toLowerCase()} ${profile.periods.join(', ')}.` } }
    );
  }
  const classes = await sectionClasses(db, adviser, year);
  const roster = await sectionRoster(db, adviser, classes.map((klass) => klass.id));
  const key = String(learner_id).trim().toLowerCase();
  if (!roster.has(key)) throw notFound('That learner is not in your advisory section.');

  // Learners belong to the school, so there is one row for this learner ID
  // in the adviser's school. A learner of another school is never found here.
  const found = await db.query(
    `SELECT id FROM learners WHERE LOWER(TRIM(learner_id)) = $1 AND school_id = $2 LIMIT 1`,
    [key, adviser.school_id]
  );
  if (found.rowCount === 0) throw notFound('That learner is not in your advisory section.');
  const learnerPk = found.rows[0].id;

  const text = String(comment || '').trim();
  if (text === '') {
    await db.query(
      'DELETE FROM report_card_comments WHERE learner_id = $1 AND period = $2 AND academic_year = $3',
      [learnerPk, period, year]
    );
    return res.json({ message: 'Comment cleared.', learner_id, period, comment: null });
  }
  const saved = await db.query(
    `INSERT INTO report_card_comments (learner_id, period, academic_year, comment, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (learner_id, period, academic_year)
     DO UPDATE SET comment = $4, updated_by = $5, updated_at = NOW()
     RETURNING comment, updated_at`,
    [learnerPk, period, year, text, req.teacher.id]
  );
  res.json({
    message: `Comment saved for ${profile.periodLabel} ${period}.`,
    learner_id,
    period,
    comment: saved.rows[0].comment,
    updated_at: saved.rows[0].updated_at,
  });
}

module.exports = {
  schoolYearMonths,
  ageOnJune1,
  buildReportCards,
  getReportCards,
  saveComment,
};
