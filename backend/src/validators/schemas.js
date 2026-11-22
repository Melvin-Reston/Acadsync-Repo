// Input rules for every request. Each schema trims text and reports a clear message per field.
const { z } = require('zod');
const { passwordProblem } = require('../utils/passwords');

// ---------- Small reusable pieces ----------
const text = (label, max = 120) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const optionalText = (label, max = 200) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().default('');

const email = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required.')
  .max(254, 'Email is too long.')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.');

// Philippine mobile number: 09XXXXXXXXX, 9XXXXXXXXX or +639XXXXXXXXX
const mobile = z
  .string({ error: 'Mobile number is required.' })
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^(\+63|0)?9\d{9}$/, 'Enter a valid mobile number, for example 09171234567.'));

const username = z
  .string({ error: 'Username is required.' })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'Use 3 to 30 letters, numbers, dots, dashes or underscores.');

const password = z.string({ error: 'Password is required.' }).superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

const id = z.coerce.number({ error: 'Invalid id.' }).int('Invalid id.').positive('Invalid id.');

const page = z.coerce.number().int().min(1).optional().default(1);
const pageSize = z.coerce.number().int().min(1).max(100).optional().default(10);
const search = z.string().trim().max(100).optional().default('');
const optionalId = z.preprocess((value) => (value === '' ? undefined : value), id.optional());
// True for a real calendar date written as YYYY-MM-DD (so 2026-02-31 is refused).
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const optionalDate = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().refine(isRealDate, 'Use a real date in the format YYYY-MM-DD.').optional()
);

// A required real calendar date, YYYY-MM-DD.
const dateString = z
  .string({ error: 'Date is required.' })
  .refine(isRealDate, 'Use a real date in the format YYYY-MM-DD.');

// ---------- Auth ----------
const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(200),
});

const forgotPasswordSchema = z.object({ email });

const resetPasswordSchema = z.object({
  token: z.string({ error: 'Reset link is not valid.' }).min(20, 'Reset link is not valid.').max(200),
  new_password: password,
});

const changePasswordSchema = z.object({
  current_password: z.string({ error: 'Current password is required.' }).min(1, 'Current password is required.'),
  new_password: password,
});

const profileSchema = z.object({ full_name: text('Full name', 100), email });

// ---------- Admin account (managed by the Super User) ----------
const adminAccountSchema = z.object({
  full_name: text('Full name', 100),
  email,
  is_active: z.boolean({ error: 'Choose enabled or disabled.' }),
});

// ---------- Teachers ----------
const teacherCreateSchema = z.object({
  first_name: text('First name', 60),
  last_name: text('Last name', 60),
  email,
  mobile,
  username,
  school_id: id,
  present_address: optionalText('Present address'),
  temporary_password: password,
  // Optional: start a subscription for the new teacher straight away.
  plan_id: optionalId,
  with_trial: z.boolean().optional().default(true),
});

const teacherUpdateSchema = z.object({
  first_name: text('First name', 60),
  last_name: text('Last name', 60),
  email,
  mobile,
  username,
  school_id: id,
  present_address: optionalText('Present address'),
});

const restrictSchema = z.object({ reason: text('Reason', 300).min(5, 'Give a short reason (at least 5 characters).') });

const teacherListSchema = z.object({
  search,
  school_id: optionalId,
  status: z.enum(['', 'active', 'restricted']).optional().default(''),
  page,
  page_size: pageSize,
});

const teacherLoginSchema = z.object({
  login: z.string({ error: 'Username or email is required.' }).trim().toLowerCase().min(1, 'Username or email is required.').max(254),
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(200),
  // "Remember this device": a 30-day session instead of the usual 8 hours.
  remember_me: z.boolean().optional().default(false),
});

// ---------- Schools ----------
const schoolSchema = z.object({
  name: text('School name', 150),
  category: z.enum(['Primary', 'Secondary'], { error: 'Choose Primary or Secondary.' }),
  school_type: z.enum(['Public', 'Private'], { error: 'Choose Public or Private.' }),
  city_region: text('City or region', 100),
  principal_contact: optionalText('Principal / contact', 150),
});

const schoolListSchema = z.object({
  search,
  category: z.enum(['', 'Primary', 'Secondary']).optional().default(''),
  school_type: z.enum(['', 'Public', 'Private']).optional().default(''),
  page,
  page_size: pageSize,
});

const schoolMergeSchema = z
  .object({ keep_id: id, remove_id: id })
  .refine((value) => value.keep_id !== value.remove_id, { path: ['remove_id'], message: 'Choose two different schools.' });

// ---------- Activity log ----------
const activityListSchema = z.object({
  search,
  action: z.string().trim().max(60).optional().default(''),
  admin_id: optionalId,
  from: optionalDate,
  to: optionalDate,
  page,
  page_size: pageSize,
});

// ---------- Settings ----------
const academicYearSchema = z.object({
  academic_year: z
    .string({ error: 'Academic year is required.' })
    .trim()
    .regex(/^\d{4}-\d{4}$/, 'Use the format 2026-2027.')
    .refine((value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1, 'The second year must be the year after the first.'),
});

const idParamSchema = z.object({ id });

// ---------- Part 2: small reusable pieces ----------
// Money in pesos, sent as 100, "100" or "100.50". Kept as text ("100.50") so no cents are lost.
const money = (label) =>
  z
    .union([z.string(), z.number()], { error: `${label} is required.` })
    .transform((value) => String(value).trim())
    .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, `${label} must be an amount like 100 or 100.50.`))
    .transform((value) => Number(value).toFixed(2));

const wholeNumber = (label, min, max) =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be ${min} or more.`)
    .max(max, `${label} must be ${max} or less.`);

// Checkboxes arrive as true/false from JSON and as "true"/"false" from an upload form.
const flag = z.preprocess((value) => (value === 'true' ? true : value === 'false' ? false : value), z.boolean().optional().default(false));

const requiredDate = (label) =>
  z.string({ error: `${label} is required.` }).refine(isRealDate, `${label} must be a real date like 2026-11-30.`);

// ---------- Plans & Packages ----------
const planSchema = z
  .object({
    name: text('Plan name', 60),
    price: money('Price'),
    billing_cycle: z.enum(['monthly', 'yearly', 'one_time'], { error: 'Choose a billing cycle.' }),
    duration_months: wholeNumber('Duration', 1, 120).optional().default(1),
    trial_days: wholeNumber('Trial days', 0, 365).optional().default(0),
    features: z.array(text('Feature', 80)).max(20, 'Use 20 features or fewer.').optional().default([]),
    is_popular: z.boolean().optional().default(false),
    sort_order: wholeNumber('Sort order', 0, 9999).optional().default(0),
  })
  .transform((plan) => ({
    ...plan,
    // A monthly plan always lasts 1 month and a yearly plan 12. Only a one-time plan sets its own length.
    duration_months: plan.billing_cycle === 'monthly' ? 1 : plan.billing_cycle === 'yearly' ? 12 : plan.duration_months,
    // A free plan has nothing to try before paying.
    trial_days: Number(plan.price) === 0 ? 0 : plan.trial_days,
  }));

// ---------- Subscriptions ----------
const subscriptionListSchema = z.object({
  search,
  plan_id: optionalId,
  teacher_id: optionalId,
  status: z.enum(['', 'trial', 'active', 'past_due', 'expired', 'cancelled', 'current']).optional().default(''),
  page,
  page_size: pageSize,
});

const subscriptionCreateSchema = z.object({
  teacher_id: id,
  plan_id: id,
  with_trial: z.boolean().optional().default(true),
});

const subscriptionExtendSchema = z.object({ months: wholeNumber('Months', 1, 24) });
const subscriptionCancelSchema = z.object({ reason: optionalText('Reason', 300) });
const subscriptionChangePlanSchema = z.object({ plan_id: id, with_trial: z.boolean().optional().default(false) });

// ---------- Invoices & payments ----------
const invoiceListSchema = z.object({
  search,
  status: z.enum(['', 'unpaid', 'overdue', 'paid', 'void']).optional().default(''),
  teacher_id: optionalId,
  subscription_id: optionalId,
  from: optionalDate,
  to: optionalDate,
  page,
  page_size: pageSize,
});

const invoiceVoidSchema = z.object({ reason: text('Reason', 300).min(5, 'Give a short reason (at least 5 characters).') });

const paymentListSchema = z.object({
  search,
  status: z.enum(['', 'pending', 'confirmed', 'rejected']).optional().default(''),
  source: z.enum(['', 'teacher', 'admin']).optional().default(''),
  from: optionalDate,
  to: optionalDate,
  page,
  page_size: pageSize,
});

// Used when the admin records a payment by hand and when a teacher sends a QR payment.
const paymentSubmitSchema = z.object({
  reference_number: text('Reference number', 60),
  paid_on: optionalDate,
  note: optionalText('Note', 300),
});

const paymentRejectSchema = z.object({ reason: text('Reason', 300).min(5, 'Give a short reason (at least 5 characters).') });

// ---------- Reports ----------
const reportSchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    format: z.enum(['', 'json', 'csv']).optional().default(''),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, { path: ['to'], message: 'The end date must be on or after the start date.' });

// ---------- Announcements ----------
const announcementSchema = z
  .object({
    title: text('Title', 120),
    body: text('Message', 2000),
    audience: z.enum(['all', 'free', 'pro'], { error: 'Choose who sees this.' }),
    starts_on: z.preprocess((value) => (value === '' || value === null ? undefined : value), requiredDate('Start date').optional()),
    ends_on: requiredDate('End date'),
  })
  .refine((value) => !value.starts_on || value.starts_on <= value.ends_on, { path: ['ends_on'], message: 'The end date must be on or after the start date.' });

const announcementListSchema = z.object({
  search,
  status: z.enum(['', 'live', 'scheduled', 'ended']).optional().default(''),
  audience: z.enum(['', 'all', 'free', 'pro']).optional().default(''),
  page,
  page_size: pageSize,
});

// ---------- Teacher Batch 1: public sign-up and the teacher's own profile ----------
// The username is not sent by the browser: the API derives it from the email address.
const teacherRegisterSchema = z.object({
  first_name: text('First name', 60),
  last_name: text('Last name', 60),
  email,
  mobile,
  present_address: optionalText('Present address'),
  school_id: id,
  password,
  terms_accepted: z.boolean({ error: 'Please accept the Terms of Service and Data Privacy Notice.' }).refine((value) => value === true, {
    message: 'Please accept the Terms of Service and Data Privacy Notice.',
  }),
});

// Only these fields may be changed by the teacher. The teaching assignment is read-only here;
// it is changed on its own form (teacherAdviserSchema), and the API refuses it here.
// The school details (region, division, DepEd school ID, school head name)
// are the teacher's own entries for the DepEd print forms; they print blank
// until the teacher fills them in.
const teacherProfileSchema = z.object({
  // A profile update is partial: only the fields sent change. The profile
  // page sends the whole form; an API caller may send just the school
  // details. Absent fields stay as they are.
  first_name: text('First name', 60).optional(),
  last_name: text('Last name', 60).optional(),
  email: email.optional(),
  mobile: mobile.optional(),
  present_address: optionalText('Present address'),
  region: optionalText('Region', 60),
  division: optionalText('Division', 60),
  deped_school_id: optionalText('School ID', 20),
  school_head_name: optionalText('School head', 100),
});

const teacherAdviserSchema = z
  .object({
    is_adviser: z.boolean({ error: 'Choose whether you are an adviser.' }),
    advisory_grade: z.preprocess(
      (value) => (value === '' || value === null ? undefined : value),
      wholeNumber('Advisory grade', 7, 12).optional()
    ),
    advisory_section: z.preprocess(
      (value) => (value === '' || value === null ? undefined : value),
      text('Advisory section', 60).optional()
    ),
  })
  .refine((value) => !value.is_adviser || (value.advisory_grade && value.advisory_section), {
    path: ['advisory_section'],
    message: 'Choose an advisory grade and type the advisory section.',
  })
  .transform((value) => ({
    is_adviser: value.is_adviser,
    advisory_grade: value.is_adviser ? value.advisory_grade : null,
    advisory_section: value.is_adviser ? value.advisory_section : null,
  }));

// Choosing a plan for the signed-in teacher.
const teacherSubscriptionSchema = z.object({ plan_id: id });

// ---------- Payment QR code settings ----------
const paymentSettingsSchema = z.object({
  account_name: optionalText('Account name', 120),
  instructions: optionalText('Instructions', 1000),
  remove_qr: flag,
});

// ---------- Teacher Batch 2: classes, learners, meetings, schedules ----------
// A time of day written as HH:MM (24-hour clock).
const timeOfDay = (label) =>
  z.string({ error: `${label} is required.` }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label} must be a time like 07:30.`);

const academicYear = z
  .string({ error: 'Academic year is required.' })
  .trim()
  .regex(/^\d{4}-\d{4}$/, 'Use the format 2026-2027.')
  .refine((value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1, 'The second year must be the year after the first.');

// The teacher's own subject library. A subject is tied to one grade level.
// The group decides the default weights under DO 015: core 20/50/30,
// MAPEH and EPP/TLE 20/60/20. Under DO 8 the group does not change the weights.
// The group is optional: when it is left out, the server guesses it from the
// name (Music and Arts is MAPEH), and the teacher can correct it afterwards.
const subjectSchema = z.object({
  name: text('Subject name', 60),
  grade_level: wholeNumber('Grade level', 7, 12),
  group: z.enum(['core', 'mapeh', 'epp_tle'], { error: 'Choose Core, MAPEH or EPP/TLE.' }).optional(),
});

const classListSchema = z.object({
  search,
  grade: z.preprocess((value) => (value === '' ? undefined : value), wholeNumber('Grade level', 7, 12).optional()),
  academic_year: z.string().trim().max(9).optional().default(''),
  subject_id: optionalId,
  page,
  page_size: pageSize,
});

// Either an existing subject or a new one created on the spot. The grade level
// always comes from the subject, so a class can never disagree with its subject.
const classCreateSchema = z
  .object({
    subject_id: optionalId,
    new_subject_name: z.preprocess((value) => (value === '' ? undefined : value), text('Subject name', 60).optional()),
    grade_level: wholeNumber('Grade level', 7, 12),
    section_name: text('Section name', 40),
    room: optionalText('Room', 30),
    academic_year: academicYear,
  })
  .refine((value) => Boolean(value.subject_id) !== Boolean(value.new_subject_name), {
    path: ['subject_id'],
    message: 'Choose a subject, or type a new subject name.',
  });

const classUpdateSchema = z.object({
  subject_id: id,
  section_name: text('Section name', 40),
  room: optionalText('Room', 30),
  academic_year: academicYear,
});

// A learner belongs to the school, not the teacher who added them.
// learner_id is the school's learner number (for example STU-2026-1048),
// unique per school. The birthdate is optional and can never be in the future.
const birthdate = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z
    .string()
    .refine(isRealDate, 'Use a real date in the format YYYY-MM-DD.')
    .refine((value) => value <= new Date().toISOString().slice(0, 10), 'The birthdate cannot be in the future.')
    .optional()
);

const learnerSchema = z.object({
  first_name: text('First name', 60),
  last_name: text('Last name', 60),
  learner_id: text('Learner ID', 30),
  sex: z.enum(['Male', 'Female'], { error: 'Choose Male or Female.' }),
  birthdate,
});

const learnerListSchema = z.object({
  search,
  page,
  page_size: pageSize,
});

const enrolSchema = z.object({ learner_id: id });

const classLearnerParamsSchema = z.object({ id, learnerId: id });

// One meeting of a class, repeated every week. day_of_week 1 is Monday, 5 is Friday.
// repeat_week creates the same meeting on every weekday instead of just one.
const meetingSchema = z
  .object({
    class_id: id,
    day_of_week: wholeNumber('Day of week', 1, 5),
    start_time: timeOfDay('Start time'),
    end_time: timeOfDay('End time'),
    room: optionalText('Room', 30),
    repeat_week: z.boolean().optional().default(false),
  })
  .refine((value) => value.end_time > value.start_time, { path: ['end_time'], message: 'The end time must be after the start time.' });

const meetingUpdateSchema = z
  .object({
    day_of_week: wholeNumber('Day of week', 1, 5),
    start_time: timeOfDay('Start time'),
    end_time: timeOfDay('End time'),
    room: optionalText('Room', 30),
  })
  .refine((value) => value.end_time > value.start_time, { path: ['end_time'], message: 'The end time must be after the start time.' });

const meetingListSchema = z.object({
  class_id: optionalId,
  day_of_week: z.preprocess((value) => (value === '' ? undefined : value), wholeNumber('Day of week', 1, 5).optional()),
  page,
  page_size: pageSize,
});

// A week is Monday to Friday. week_start is any date in that week; it is snapped
// back to the Monday. format=csv downloads the week's timetable.
const scheduleQuerySchema = z.object({
  week_start: optionalDate,
  format: z.enum(['', 'json', 'csv']).optional().default(''),
});

// ---------- Teacher Batch 3: attendance ----------
// One row of the roll: a learner, a status, and how they were marked. time_in is
// the time the mark was tapped (HH:MM, Manila time); the server stamps it when
// none is sent, and keeps the old one when the status did not change.
const attendanceStatus = z.enum(['present', 'late', 'absent', 'excused'], {
  error: 'Choose Present, Late, Absent or Excused.',
});

const attendanceMarkSchema = z.object({
  learner_id: id,
  status: attendanceStatus,
  method: z.enum(['manual', 'qr']).optional().default('manual'),
  time_in: timeOfDay('Time in').optional(),
});

const attendanceQuerySchema = z.object({
  class_id: id,
  date: optionalDate,
  format: z.enum(['', 'json', 'csv']).optional().default(''),
});

// School Form 2 (Batch 8): one month, YYYY-MM, of the academic year.
const sf2QuerySchema = z.object({
  class_id: id,
  month: z.string({ error: 'Choose a month.' }).regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.'),
});

const attendanceSaveSchema = z.object({
  class_id: id,
  date: dateString,
  marks: z.array(attendanceMarkSchema).max(500, 'Too many learners in one roll.'),
});

const attendanceLookupSchema = z.object({
  class_id: id,
  date: optionalDate,
  code: text('Student ID', 60),
});

const attendanceCheckInSchema = z.object({
  class_id: id,
  date: dateString,
  learner_id: id,
});

// ---------- Teacher Batch 4: grades and consolidation ----------
const quarterParam = z.preprocess(
  (value) => (value === '' ? undefined : value),
  wholeNumber('Quarter', 1, 4).optional()
);

const gradeSheetQuerySchema = z.object({
  quarter: quarterParam,
  format: z.enum(['', 'json', 'csv']).optional().default(''),
});

const gradeColumnParamsSchema = z.object({ id, columnId: id });

const gradeScoreSchema = z.object({
  column_id: id,
  learner_id: id,
  score: z
    .union([z.number(), z.null()], { error: 'Score must be a number.' })
    .refine((value) => value === null || Number.isFinite(value), 'Score must be a number.'),
});

const gradeSaveScoresSchema = z.object({
  quarter: wholeNumber('Quarter', 1, 4),
  scores: z.array(gradeScoreSchema).max(2000, 'Too many scores in one save.'),
});

const gradeAddColumnSchema = z.object({
  quarter: wholeNumber('Quarter', 1, 4),
  component: z.enum(['WW', 'PT', 'EX'], { error: 'Choose WW, PT or EX.' }),
});

const gradeUpdateColumnSchema = z.object({
  highest_possible: z.coerce
    .number({ error: 'Highest possible score must be a number.' })
    .gt(0, 'Highest possible score must be more than 0.')
    .max(1000, 'Highest possible score is too large.'),
});

// The Examinations sub-weights for one period, saved together: each EX
// column's share of the component (ST1 30, ST2 30, Term Exam 40), adding
// up to 100. They are saved as a set, so the total is checked here.
const gradeSubWeightsSchema = z
  .object({
    quarter: wholeNumber('Quarter', 1, 4),
    sub_weights: z
      .array(
        z.object({
          column_id: id,
          sub_weight: wholeNumber('Sub-weight', 0, 100),
        })
      )
      .min(1, 'Give the sub-weight for each Examinations column.')
      .max(20, 'Too many columns.'),
  })
  .refine(
    (value) => new Set(value.sub_weights.map((entry) => entry.column_id)).size === value.sub_weights.length,
    { path: ['sub_weights'], message: 'List each column once.' }
  )
  .refine((value) => value.sub_weights.reduce((sum, entry) => sum + entry.sub_weight, 0) === 100, {
    path: ['sub_weights'],
    message: 'The Examinations sub-weights must add up to 100.',
  });

// The three weights must add up to 100.
const gradeWeightsSchema = z
  .object({
    ww_weight: wholeNumber('WW weight', 0, 100),
    pt_weight: wholeNumber('PT weight', 0, 100),
    ex_weight: wholeNumber('EX weight', 0, 100),
  })
  .refine((value) => value.ww_weight + value.pt_weight + value.ex_weight === 100, {
    path: ['ww_weight'],
    message: 'The three weights must add up to 100.',
  });

// The grading system for one academic year. do8_2015 is DO 8, s. 2015
// (4 quarters); do015_adjusted is DO 015 for SY 2026-2027 (3 terms, the
// adjusted table); do015_zero_based is DO 015 from SY 2027-2028 (3 terms,
// no transmutation).
const gradingProfileSchema = z.object({
  academic_year: z
    .string({ error: 'Academic year is required.' })
    .trim()
    .regex(/^\d{4}-\d{4}$/, 'Use the format 2026-2027.')
    .refine((value) => Number(value.slice(5)) === Number(value.slice(0, 4)) + 1, 'The second year must be the year after the first.'),
  profile: z.enum(['do8_2015', 'do015_adjusted', 'do015_zero_based'], { error: 'Choose a grading system.' }),
});

const gradeSubmitSchema = z.object({
  quarter: wholeNumber('Quarter', 1, 4),
  confirm_blanks: z.boolean().optional().default(false),
});

const consolidationQuerySchema = z.object({
  quarter: quarterParam,
  format: z.enum(['', 'json', 'csv']).optional().default(''),
  // The quarter view, or the final grades across the year's periods.
  scope: z.enum(['', 'quarter', 'final']).optional().default(''),
});

const remindSchema = z.object({
  class_id: id,
  quarter: wholeNumber('Quarter', 1, 4),
});

// The teacher's comment on a report card: one learner, one period. A blank
// comment clears the saved one, so the comment itself is optional text.
const reportCardCommentSchema = z.object({
  learner_id: text('Learner', 50),
  period: wholeNumber('Period', 1, 4),
  comment: z.string({ error: 'Comment is required.' }).trim().max(1000, 'A comment must be 1000 characters or fewer.'),
});

module.exports = {
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  profileSchema,
  adminAccountSchema,
  teacherCreateSchema,
  teacherUpdateSchema,
  restrictSchema,
  teacherListSchema,
  teacherLoginSchema,
  schoolSchema,
  schoolListSchema,
  schoolMergeSchema,
  activityListSchema,
  academicYearSchema,
  idParamSchema,
  planSchema,
  subscriptionListSchema,
  subscriptionCreateSchema,
  subscriptionExtendSchema,
  subscriptionCancelSchema,
  subscriptionChangePlanSchema,
  invoiceListSchema,
  invoiceVoidSchema,
  paymentListSchema,
  paymentSubmitSchema,
  paymentRejectSchema,
  reportSchema,
  announcementSchema,
  announcementListSchema,
  paymentSettingsSchema,
  teacherRegisterSchema,
  teacherProfileSchema,
  teacherAdviserSchema,
  teacherSubscriptionSchema,
  subjectSchema,
  classListSchema,
  classCreateSchema,
  classUpdateSchema,
  learnerSchema,
  learnerListSchema,
  enrolSchema,
  classLearnerParamsSchema,
  meetingSchema,
  meetingUpdateSchema,
  meetingListSchema,
  scheduleQuerySchema,
  attendanceQuerySchema,
  attendanceSaveSchema,
  sf2QuerySchema,
  attendanceLookupSchema,
  attendanceCheckInSchema,
  gradeSheetQuerySchema,
  gradeSaveScoresSchema,
  gradeAddColumnSchema,
  gradeColumnParamsSchema,
  gradeUpdateColumnSchema,
  gradeSubWeightsSchema,
  gradeWeightsSchema,
  gradingProfileSchema,
  gradeSubmitSchema,
  consolidationQuerySchema,
  remindSchema,
  reportCardCommentSchema,
};
