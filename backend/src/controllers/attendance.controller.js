// Attendance: the daily roll sheet for the teacher's own classes and the QR
// check-in. Every query is scoped to the signed-in teacher (req.teacher.id);
// an id from the request can never reach another teacher's rows.
//
// A QR code holds the learner's school learner ID, for example
// "acadsync:STU-2026-1048". The code itself is not a secret — the learner ID
// is already shown on the roster — it only says who the learner is. A scan
// never marks attendance by itself: the lookup shows the learner's card first
// and the teacher confirms, and the check-in only ever marks the selected
// class and date.
const db = require('../db');
const { badRequest, notFound } = require('../utils/httpError');
const { sendCsv } = require('../utils/csv');
const { manilaParts, formatTime, findClass, findLearner, teacherSchoolId } = require('./classes.controller');

const STATUSES = ['present', 'late', 'absent', 'excused'];
const STATUS_LABEL = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };

// The learner ID inside a scanned code. Accepts the full QR payload
// ("acadsync:STU-2026-1048") and a bare learner ID ("STU-2026-1048").
function learnerIdFromCode(code) {
  const trimmed = String(code || '').trim();
  const prefix = 'acadsync:';
  return trimmed.toLowerCase().startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed;
}

// A date must be a real day and never in the future (in the school's timezone).
function assertNotFuture(date) {
  if (date > manilaParts().date) {
    throw badRequest('You cannot take attendance for a future date.', {
      errors: { date: 'Choose today or an earlier date.' },
    });
  }
}

// The saved mark for one learner on one date, or null when they are unmarked.
async function findMark(client, classId, learnerId, date) {
  const result = await client.query(
    `SELECT id, status, time_in::text AS time_in, method, created_at, updated_at
       FROM attendance WHERE class_id = $1 AND learner_id = $2 AND date = $3`,
    [classId, learnerId, date]
  );
  return result.rows[0] || null;
}

// ---------- The roll ----------

// GET /api/teacher/attendance?class_id=&date=  (the roll for one class and date;
// add format=csv to download the day sheet instead)
async function getRoll(req, res) {
  const { class_id, date, format } = req.valid.query;
  const day = date || manilaParts().date;
  assertNotFuture(day);
  const klass = await findClass(class_id, req.teacher.id);

  const learners = await db.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex,
            a.status, a.time_in::text AS time_in, a.method,
            a.updated_at AS marked_at
       FROM class_learners cl
       JOIN learners l ON l.id = cl.learner_id
       LEFT JOIN attendance a
         ON a.class_id = cl.class_id AND a.learner_id = cl.learner_id AND a.date = $2
      WHERE cl.class_id = $1
      ORDER BY l.last_name, l.first_name, l.id`,
    [class_id, day]
  );

  const rows = learners.rows.map((row) => ({
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    learner_id: row.learner_id,
    sex: row.sex,
    mark: row.status
      ? { status: row.status, time_in: row.time_in ? row.time_in.slice(0, 5) : null, method: row.method }
      : null,
  }));

  if (format === 'csv') {
    sendCsv(
      res,
      `attendance-${klass.subject_name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${klass.section_name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${day}.csv`,
      [
        { header: 'Learner ID', value: (row) => row.learner_id },
        { header: 'Last name', value: (row) => row.last_name },
        { header: 'First name', value: (row) => row.first_name },
        { header: 'Sex', value: (row) => row.sex },
        { header: 'Status', value: (row) => (row.mark ? STATUS_LABEL[row.mark.status] : 'Not marked') },
        { header: 'Time in', value: (row) => (row.mark && row.mark.time_in ? formatTime(row.mark.time_in) : '') },
        { header: 'Method', value: (row) => (row.mark ? (row.mark.method === 'qr' ? 'QR' : 'Manual') : '') },
      ],
      rows
    );
    return;
  }

  const marked = rows.filter((row) => row.mark).length;
  const savedAt = await db.query(
    'SELECT MAX(updated_at) AS saved_at FROM attendance WHERE class_id = $1 AND date = $2',
    [class_id, day]
  );
  res.json({
    class: klass,
    date: day,
    saved: marked > 0,
    saved_at: savedAt.rows[0].saved_at,
    learners: rows,
  });
}

// ---------- School Form 2 (Batch 8) ----------

const SF2_WEEKDAYS = ['', 'M', 'T', 'W', 'TH', 'F', '']; // index by getUTCDay(): 1 Mon .. 5 Fri
const SF2_MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

// GET /api/teacher/attendance/sf2?class_id=&month=YYYY-MM
// The month's daily attendance for one class, in School Form 2 shape: one
// column per Monday–Friday day, X = Absent, L = Late, E = Excused, blank =
// Present. A blank day counts as present — the form's own code — so a
// learner's PRESENT total is the month's school days minus Absent (X) marks
// minus Excused (E) marks, and a day cell in a TOTAL row counts the learners
// with no X and no E that day. Excused days are separate: they count in
// neither the PRESENT nor the ABSENT total. Learners are Male first, then
// Female, each group alphabetical by last name, numbered continuously. The
// footer summary follows the form's own formulas; figures the system cannot
// know (enrolment as of the 1st Friday, late enrolment, dropped out,
// transferred) are left to handwriting and are not invented here.
async function getSf2(req, res) {
  const { class_id, month } = req.valid.query;
  const klass = await findClass(class_id, req.teacher.id);
  const [year, monthNumber] = month.split('-').map(Number);

  // The school details the teacher entered for the DepEd forms.
  const teacher = await db.query(
    `SELECT t.first_name, t.last_name, t.region, t.division, t.deped_school_id,
            t.school_head_name, s.name AS school_name
       FROM teachers t JOIN schools s ON s.id = t.school_id WHERE t.id = $1`,
    [req.teacher.id]
  );

  // Monday–Friday days of the month only (UTC dates, so no timezone shifts).
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day));
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      days.push({
        date: `${month}-${String(day).padStart(2, '0')}`,
        day,
        weekday: SF2_WEEKDAYS[weekday],
      });
    }
  }

  // Male first, then Female, each group alphabetical by last name — the
  // DepEd form's order, with one continuous numbering across both groups.
  const learners = await db.query(
    `SELECT l.id, l.first_name, l.last_name, l.learner_id, l.sex
       FROM class_learners cl JOIN learners l ON l.id = cl.learner_id
      WHERE cl.class_id = $1
      ORDER BY CASE WHEN l.sex = 'Male' THEN 0 ELSE 1 END, l.last_name, l.first_name, l.id`,
    [class_id]
  );

  const nextMonth = monthNumber === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
  const marks = await db.query(
    `SELECT learner_id, date::text AS date, status FROM attendance
      WHERE class_id = $1 AND date >= $2 AND date < $3`,
    [class_id, `${month}-01`, nextMonth]
  );
  const byLearner = new Map();
  const schoolDays = new Set(days.map((day) => day.date));
  for (const row of marks.rows) {
    // A roll saved on a weekend is not a school day: it stays out of the
    // marks and the totals entirely.
    if (!schoolDays.has(row.date)) continue;
    if (!byLearner.has(row.learner_id)) byLearner.set(row.learner_id, {});
    byLearner.get(row.learner_id)[row.date] = row.status;
  }

  const rows = learners.rows.map((learner) => {
    const marksByDate = byLearner.get(learner.id) || {};
    // Blank = Present: every shown school day counts as present except
    // Absent (X) and Excused (E) days. Late (L) counts as present.
    let absent = 0;
    let excused = 0;
    for (const status of Object.values(marksByDate)) {
      if (status === 'absent') absent += 1;
      else if (status === 'excused') excused += 1;
    }
    return {
      id: learner.id,
      first_name: learner.first_name,
      last_name: learner.last_name,
      learner_id: learner.learner_id,
      sex: learner.sex,
      marks: marksByDate,
      totals: { present: days.length - absent - excused, absent },
    };
  });

  // A TOTAL row for a list of learners: a day cell counts the learners
  // present that day (no X and no E — blank and L count), and the month
  // totals sum the day cells and the X marks. The Combined TOTAL Per Day
  // row covers all learners; each gender row covers only its own group.
  const totalsFor = (list) => {
    const presentByDay = {};
    for (const day of days) {
      presentByDay[day.date] = list.filter((row) => {
        const status = row.marks[day.date];
        return status !== 'absent' && status !== 'excused';
      }).length;
    }
    return {
      present_by_day: presentByDay,
      totals: {
        present: Object.values(presentByDay).reduce((sum, count) => sum + count, 0),
        absent: list.reduce((sum, row) => sum + row.totals.absent, 0),
      },
    };
  };
  const males = rows.filter((row) => row.sex === 'Male');
  const females = rows.filter((row) => row.sex === 'Female');
  // A gender with no learners has no total row: null, never an empty one.
  const totalsByGender = {
    male: males.length === 0 ? null : totalsFor(males),
    female: females.length === 0 ? null : totalsFor(females),
  };
  const combined = totalsFor(rows);

  // The footer summary table, per the form's Guidelines formulas.
  // Average Daily Attendance = total present-days / number of school days
  // in the month; Percentage of Attendance = Average Daily Attendance /
  // Registered Learners x 100. Both to one decimal. A learner counts toward
  // the 5-consecutive-days figure once when 5 or more school-day columns in
  // a row are X in a row (weekends are not columns, so Friday-to-Monday
  // runs are consecutive). A null percentage means there is nothing to
  // divide by, and the form leaves it blank.
  const round1 = (value) => Math.round(value * 10) / 10;
  const summarize = (list) => {
    const registered = list.length;
    const totalPresent = list.reduce((sum, row) => sum + row.totals.present, 0);
    const average = days.length === 0 ? 0 : totalPresent / days.length;
    let absentFiveDays = 0;
    for (const row of list) {
      let run = 0;
      let hit = false;
      for (const day of days) {
        if (row.marks[day.date] === 'absent') {
          run += 1;
          if (run >= 5) hit = true;
        } else {
          run = 0;
        }
      }
      if (hit) absentFiveDays += 1;
    }
    return {
      registered,
      average_daily_attendance: round1(average),
      percentage_of_attendance: registered === 0 ? null : round1((average / registered) * 100),
      absent_five_days: absentFiveDays,
    };
  };
  const summary = {
    days_of_classes: days.length,
    male: summarize(males),
    female: summarize(females),
    total: summarize(rows),
  };

  const school = teacher.rows[0] || {};
  res.json({
    class: klass,
    month,
    month_label: SF2_MONTHS[monthNumber - 1],
    school_year: String(klass.academic_year || '').replace('-', ' - '),
    adviser_name: school.first_name ? `${school.first_name} ${school.last_name}` : null,
    school: {
      name: school.school_name || null,
      region: school.region || null,
      division: school.division || null,
      deped_school_id: school.deped_school_id || null,
      school_head_name: school.school_head_name || null,
    },
    days,
    learners: rows,
    combined,
    totals_by_gender: totalsByGender,
    summary,
  });
}

// POST /api/teacher/attendance  { class_id, date, marks: [{ learner_id, status, method?, time_in? }] }
// Saves the whole roll for one class and date in one transaction. Re-saving an
// existing date replaces it. A learner's time-in is kept when their status did
// not change (re-saving must not move the time they arrived); a new present or
// late mark is stamped with the time it was tapped, or with the current Manila
// time when none was sent. Absent and excused never have a time-in.
async function saveRoll(req, res) {
  const { class_id, date, marks } = req.valid.body;
  assertNotFuture(date);
  const klass = await findClass(class_id, req.teacher.id);

  // Every learner in the roll must be enrolled in this class.
  const enrolled = await db.query('SELECT learner_id FROM class_learners WHERE class_id = $1', [class_id]);
  const enrolledIds = new Set(enrolled.rows.map((row) => row.learner_id));
  for (const mark of marks) {
    if (!enrolledIds.has(mark.learner_id)) {
      throw badRequest('One of the learners is not enrolled in this class.', {
        errors: { marks: 'Every learner in the roll must be enrolled in this class.' },
      });
    }
  }
  // The same learner twice in one roll is a mistake, not two marks.
  if (new Set(marks.map((mark) => mark.learner_id)).size !== marks.length) {
    throw badRequest('A learner appears twice in the roll.', { errors: { marks: 'List each learner once.' } });
  }

  const now = manilaParts().time;
  await db.withTransaction(async (client) => {
    const existing = await client.query(
      'SELECT learner_id, status, time_in::text AS time_in, method FROM attendance WHERE class_id = $1 AND date = $2',
      [class_id, date]
    );
    const byLearner = new Map(existing.rows.map((row) => [row.learner_id, row]));

    await client.query('DELETE FROM attendance WHERE class_id = $1 AND date = $2', [class_id, date]);
    for (const mark of marks) {
      const previous = byLearner.get(mark.learner_id);
      let timeIn = null;
      if (mark.status === 'present' || mark.status === 'late') {
        // Same status as before: keep the time they arrived.
        // New or changed status: the time it was tapped, or now.
        timeIn = previous && previous.status === mark.status && previous.time_in
          ? previous.time_in.slice(0, 5)
          : mark.time_in || now;
      }
      await client.query(
        `INSERT INTO attendance (teacher_id, class_id, learner_id, date, status, time_in, method)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.teacher.id, class_id, mark.learner_id, date, mark.status, timeIn, mark.method || 'manual']
      );
    }
  });

  res.json({ message: 'Attendance saved.', class_id, date, saved: marks.length });
}

// ---------- QR check-in ----------

// GET /api/teacher/attendance/lookup?class_id=&date=&code=
// Resolves a scanned code (or a typed student ID) to the learner, for the
// detail card the teacher confirms before anything is marked. This only reads.
async function lookupLearner(req, res) {
  const { class_id, date, code } = req.valid.query;
  const day = date || manilaParts().date;
  assertNotFuture(day);
  const klass = await findClass(class_id, req.teacher.id);

  const learnerId = learnerIdFromCode(code);
  // Learners belong to the school: any teacher of the school can look the
  // learner up, and a learner of another school is never found here.
  const schoolId = await teacherSchoolId(req.teacher.id);
  const found = await db.query(
    'SELECT id, first_name, last_name, learner_id, sex FROM learners WHERE school_id = $1 AND learner_id = $2',
    [schoolId, learnerId]
  );
  if (found.rowCount === 0) throw notFound(`No learner with the ID ${learnerId}.`);

  const learner = found.rows[0];
  const enrolled = await db.query(
    'SELECT 1 FROM class_learners WHERE class_id = $1 AND learner_id = $2',
    [class_id, learner.id]
  );
  if (enrolled.rowCount === 0) {
    throw notFound(`${learner.first_name} ${learner.last_name} is not enrolled in ${klass.subject_name} · ${klass.section_name}.`);
  }

  const mark = await findMark(db, class_id, learner.id, day);
  res.json({
    learner,
    class: { id: klass.id, subject_name: klass.subject_name, grade_level: klass.grade_level, section_name: klass.section_name },
    date: day,
    mark: mark
      ? { status: mark.status, time_in: mark.time_in ? mark.time_in.slice(0, 5) : null, method: mark.method }
      : null,
  });
}

// POST /api/teacher/attendance/check-in  { class_id, date, learner_id }
// Confirms a QR check-in: marks the learner Present via QR and stamps the
// time-in. A learner already checked in by QR today keeps their first time-in.
async function checkIn(req, res) {
  const { class_id, date, learner_id } = req.valid.body;
  assertNotFuture(date);
  const klass = await findClass(class_id, req.teacher.id);
  const learner = await findLearner(learner_id, req.teacher.id);

  const enrolled = await db.query(
    'SELECT 1 FROM class_learners WHERE class_id = $1 AND learner_id = $2',
    [class_id, learner.id]
  );
  if (enrolled.rowCount === 0) {
    throw notFound(`${learner.first_name} ${learner.last_name} is not enrolled in ${klass.subject_name} · ${klass.section_name}.`);
  }

  const now = manilaParts().time;
  const saved = await db.withTransaction(async (client) => {
    const existing = await findMark(client, class_id, learner.id, date);
    if (existing && existing.status === 'present' && existing.method === 'qr') {
      return { mark: existing, already: true };
    }
    const inserted = await client.query(
      `INSERT INTO attendance (teacher_id, class_id, learner_id, date, status, time_in, method)
       VALUES ($1, $2, $3, $4, 'present', $5, 'qr')
       ON CONFLICT (class_id, learner_id, date)
       DO UPDATE SET status = 'present', time_in = $5, method = 'qr', updated_at = NOW()
       RETURNING status, time_in::text AS time_in, method`,
      [req.teacher.id, class_id, learner.id, date, now]
    );
    return { mark: inserted.rows[0], already: false };
  });

  res.json({
    message: saved.already
      ? `${learner.first_name} ${learner.last_name} is already checked in.`
      : `${learner.first_name} ${learner.last_name} checked in.`,
    learner,
    already_checked_in: saved.already,
    mark: {
      status: saved.mark.status,
      time_in: saved.mark.time_in ? saved.mark.time_in.slice(0, 5) : null,
      method: saved.mark.method,
    },
  });
}

module.exports = {
  learnerIdFromCode,
  getRoll,
  getSf2,
  saveRoll,
  lookupLearner,
  checkIn,
};
