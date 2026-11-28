// The shapes of the data the API sends back.

export type AdminRole = 'super_user' | 'admin';
// Automatic events (an expired trial, an issued invoice) are logged as 'system'.
export type ActivityRole = AdminRole | 'system';

export interface Admin {
  id: number;
  role: AdminRole;
  full_name: string;
  email: string;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
}

export interface AdminAccount extends Admin {
  is_locked: boolean;
  locked_until: string | null;
  created_at: string;
}

export interface Teacher {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  present_address: string;
  username: string;
  school_id: number;
  school_name: string;
  school_city_region: string;
  must_change_password: boolean;
  is_restricted: boolean;
  restriction_reason: string | null;
  restricted_at: string | null;
  restricted_by_name: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  // Current subscription, or the latest one. All null when the teacher never had one.
  subscription_id: number | null;
  plan_name: string | null;
  plan_price: string | null;
  subscription_status: SubscriptionStatus | null;
  subscription_period_end: string | null;
}

export interface TeacherForm {
  first_name: string;
  last_name: string;
  email: string;
  mobile: string;
  username: string;
  school_id: number | null;
  present_address: string;
  temporary_password?: string;
  plan_id?: number | null;
  with_trial?: boolean;
}

export interface School {
  id: number;
  name: string;
  category: 'Primary' | 'Secondary';
  school_type: 'Public' | 'Private';
  city_region: string;
  principal_contact: string;
  teacher_count: number;
  created_at: string;
  updated_at: string;
}

export interface SchoolForm {
  name: string;
  category: string;
  school_type: string;
  city_region: string;
  principal_contact: string;
}

export interface ActivityEntry {
  id: number;
  admin_id: number | null;
  admin_name: string;
  admin_role: ActivityRole;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  description: string;
  ip_address: string | null;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ActivityPage extends Page<ActivityEntry> {
  admins: { id: number; full_name: string; role: AdminRole }[];
}

export interface Overview {
  counts: {
    total_teachers: number;
    restricted_teachers: number;
    total_schools: number;
    new_signups_this_month: number;
    active_subscriptions: number;
    trial_subscriptions: number;
    pending_payments: number;
    income_this_month: string;
  };
  recent_teachers: {
    id: number;
    first_name: string;
    last_name: string;
    username: string;
    is_restricted: boolean;
    created_at: string;
    school_name: string;
  }[];
  recent_activity: Pick<
    ActivityEntry,
    'id' | 'admin_name' | 'admin_role' | 'action' | 'description' | 'created_at'
  >[];
  academic_year: string | null;
}

export interface PaymentSettings {
  has_qr: boolean;
  label: string;
  account_name: string;
  instructions: string;
  has_qr2: boolean;
  qr2_label: string;
  qr2_account_name: string;
  qr2_instructions: string;
  updated_at: string | null;
}

export interface Settings {
  academic_year: string;
  academic_year_updated_at: string;
  grading_profile: string;
  grading: GradingInfo;
  grading_profiles: GradingProfileOption[];
  payment: PaymentSettings;
}

// The grading system in force for one academic year.
export interface GradingInfo {
  code: string;
  label: string;
  period_label: string;
  period_short: string;
  periods: number[];
  grade_label: string;
  third_label: string;
  third_short: string;
  default_floor: number;
}

export interface GradingProfileOption {
  code: string;
  label: string;
  periods: number[];
  period_label: string;
  grade_label: string;
  third_label: string;
}

// ---------- Plans, subscriptions, invoices and payments ----------
// Money arrives as text with two decimals ("100.00") so no centavos are lost.

export type BillingCycle = 'monthly' | 'yearly' | 'one_time';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'expired' | 'cancelled';
export type InvoiceStatus = 'unpaid' | 'paid' | 'void';
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected';

export interface Plan {
  id: number;
  name: string;
  price: string;
  billing_cycle: BillingCycle;
  duration_months: number;
  trial_days: number;
  features: string[];
  is_popular: boolean;
  is_active: boolean;
  sort_order: number;
  subscription_count?: number;
  current_subscription_count?: number;
}

export interface PlanForm {
  name: string;
  price: string;
  billing_cycle: BillingCycle;
  duration_months: number;
  trial_days: number;
  features: string[];
  is_popular: boolean;
  sort_order: number;
}

export interface Subscription {
  id: number;
  teacher_id: number;
  plan_id: number;
  plan_name: string;
  price: string;
  billing_cycle: BillingCycle;
  duration_months: number;
  status: SubscriptionStatus;
  started_at: string;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
  first_name: string;
  last_name: string;
  username: string;
  teacher_email: string;
  is_restricted: boolean;
  school_name: string;
  created_by_name: string | null;
  unpaid_invoice_count: number;
}

export interface SubscriptionPage extends Page<Subscription> {
  counts: Record<SubscriptionStatus, number>;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  subscription_id: number;
  teacher_id: number;
  plan_name: string;
  amount: string;
  period_start: string;
  period_end: string;
  status: InvoiceStatus;
  issued_at: string;
  due_date: string;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  is_overdue: boolean;
  first_name: string;
  last_name: string;
  username: string;
  school_name: string;
  has_pending_payment: boolean;
}

// The short invoice rows shown inside a subscription.
export type SubscriptionInvoice = Pick<
  Invoice,
  | 'id'
  | 'invoice_number'
  | 'plan_name'
  | 'amount'
  | 'period_start'
  | 'period_end'
  | 'status'
  | 'issued_at'
  | 'due_date'
  | 'paid_at'
  | 'is_overdue'
>;

export interface InvoiceTotals {
  outstanding: string;
  overdue: string;
  paid: string;
  outstanding_count: number;
  overdue_count: number;
  paid_count: number;
}

export interface InvoicePage extends Page<Invoice> {
  totals: InvoiceTotals;
}

export interface Payment {
  id: number;
  invoice_id: number;
  teacher_id: number;
  amount: string;
  reference_number: string;
  source: 'teacher' | 'admin';
  status: PaymentStatus;
  paid_on: string;
  note: string;
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  created_at: string;
  has_screenshot: boolean;
  invoice_number: string;
  plan_name: string;
  subscription_id: number;
  invoice_status: InvoiceStatus;
  first_name: string;
  last_name: string;
  username: string;
  school_name: string;
}

export interface PaymentPage extends Page<Payment> {
  pending_count: number;
}

// ---------- Reports ----------
export interface IncomeReport {
  from: string;
  to: string;
  summary: { total: string; payment_count: number };
  by_plan: { plan_name: string; payment_count: number; total: string }[];
  items: {
    id: number;
    paid_on: string;
    invoice_number: string;
    plan_name: string;
    reference_number: string;
    source: 'teacher' | 'admin';
    amount: string;
    teacher_name: string;
    username: string;
    school_name: string;
  }[];
}

export interface SubscriptionsReport {
  from: string;
  to: string;
  summary: Record<SubscriptionStatus, number> & { total: number };
  by_plan: { plan_name: string; subscription_count: number }[];
  items: {
    id: number;
    plan_name: string;
    price: string;
    billing_cycle: BillingCycle;
    status: SubscriptionStatus;
    started_at: string;
    current_period_end: string;
    ended_at: string | null;
    teacher_name: string;
    username: string;
    school_name: string;
  }[];
}

export interface TeachersPerSchoolReport {
  from: string;
  to: string;
  summary: {
    school_count: number;
    teacher_count: number;
    added_in_range: number;
    paid_plan_count: number;
  };
  items: {
    id: number;
    name: string;
    city_region: string;
    category: string;
    school_type: string;
    teacher_count: number;
    added_in_range: number;
    restricted_count: number;
    paid_plan_count: number;
  }[];
}

// ---------- Announcements ----------
export type Audience = 'all' | 'free' | 'pro';

export interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: Audience;
  starts_on: string | null;
  ends_on: string;
  status: 'live' | 'scheduled' | 'ended';
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
}

export interface AnnouncementForm {
  title: string;
  body: string;
  audience: Audience;
  starts_on: string;
  ends_on: string;
}

// ---------- Teacher portal ----------

export interface TeacherSelf {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  mobile: string;
  present_address: string;
  school_id: number;
  school_name: string | null;
  // Whether the school has an uploaded seal (Dashboard), printed on the
  // Report Card. The image itself is fetched from its own endpoint.
  has_school_seal: boolean;
  // The teacher's own entries for the DepEd print forms; null until filled in.
  region: string | null;
  division: string | null;
  deped_school_id: string | null;
  school_head_name: string | null;
  // The school calendar for SF2 (Batch 8 fix 10): the first and last day
  // of classes, as YYYY-MM-DD text; null until filled in.
  classes_start_date: string | null;
  classes_end_date: string | null;
  must_change_password: boolean;
  is_restricted: boolean;
  is_adviser: boolean;
  advisory_grade: number | null;
  advisory_section: string | null;
  created_at?: string;
}

export interface TeacherSubscription {
  id: number;
  plan_id: number;
  plan_name: string;
  price: string;
  billing_cycle: BillingCycle;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  // The end of the teacher's one free window (from their first
  // subscription), whether or not the current subscription is a trial.
  window_ends_at: string | null;
  current_period_start: string;
  current_period_end: string;
}

export interface TeacherInvoice {
  id: number;
  invoice_number: string;
  plan_name: string;
  amount: string;
  due_date: string;
  issued_at: string;
  is_overdue: boolean;
  latest_payment_status: PaymentStatus | null;
}

// One row of the teacher's own invoice list (Batch 6): the full receipt data
// for the row, including whether a payment is waiting and why one was refused.
export interface TeacherInvoiceRow {
  id: number;
  invoice_number: string;
  plan_name: string;
  amount: string;
  period_start: string;
  period_end: string;
  status: InvoiceStatus;
  issued_at: string;
  due_date: string;
  paid_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  is_overdue: boolean;
  latest_payment_status: PaymentStatus | null;
  latest_rejection_reason: string | null;
}

// One payment on the teacher's own invoice, as shown on its receipt.
export interface TeacherInvoicePayment {
  id: number;
  amount: string;
  reference_number: string;
  status: PaymentStatus;
  paid_on: string;
  note: string;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  has_screenshot: boolean;
}

export interface TeacherAnnouncement {
  id: number;
  title: string;
  body: string;
  audience: Audience;
  starts_on: string | null;
  ends_on: string;
  created_at: string;
}

// One holiday on the teacher's school calendar: a date (YYYY-MM-DD) and
// the name the teacher gave it.
export interface TeacherHoliday {
  id: number;
  date: string;
  name: string;
}

export interface TeacherDashboard {
  teacher: TeacherSelf;
  subscription: TeacherSubscription | null;
  next_invoice: TeacherInvoice | null;
  announcements: TeacherAnnouncement[];
  academic_year: string | null;
  // The admin's current year. academic_year above is the year being viewed.
  current_academic_year?: string | null;
  class_count: number;
  learner_count: number;
  holidays: TeacherHoliday[];
  today_classes: TodayClass[];
  // Consolidation readiness for the teacher's advisory section (Batch 4).
  // Null when the teacher has no advisory assignment.
  consolidation: ConsolidationReadiness | null;
}

// One of the teacher's classes today, for the sign-in panel.
export interface TodayClass {
  id: number;
  class_id: number;
  title: string;
  room: string;
  start_time: string;
  end_time: string;
  status: 'now' | 'next';
}

export interface TeacherMe {
  teacher: TeacherSelf;
  subscription: TeacherSubscription | null;
  academic_year: string | null;
}

// ---------- Classes & Sections and Schedules (Batch 2) ----------

export interface Subject {
  id: number;
  name: string;
  grade_level: number;
  // The subject group, which decides the default weights under DO 015:
  // core 20/50/30, MAPEH and EPP/TLE 20/60/20.
  group: 'core' | 'mapeh' | 'epp_tle';
  class_count: number;
  created_at: string;
  updated_at: string;
}

export interface ClassItem {
  id: number;
  subject_id: number;
  subject_name: string;
  grade_level: number;
  section_name: string;
  room: string;
  academic_year: string;
  learner_count: number;
  meeting_count: number;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: number;
  class_id: number;
  subject_name: string;
  grade_level: number;
  section_name: string;
  room: string;
  day_of_week: number;
  day_name: string;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
}

export interface ClassLearner {
  id: number;
  first_name: string;
  last_name: string;
  learner_id: string;
  sex: 'Male' | 'Female';
  birthdate: string | null; // "2010-05-14" or null when not given
  school_name: string;
  enrolled_at: string;
}

export interface ClassDetail extends ClassItem {
  learners: ClassLearner[];
  meetings: Meeting[];
}

export interface Learner {
  id: number;
  first_name: string;
  last_name: string;
  learner_id: string;
  sex: 'Male' | 'Female';
  birthdate: string | null; // "2010-05-14" or null when not given
  school_id: number;
  school_name: string;
  classes?: string | null; // section names, comma separated
  class_count: number;
  created_at: string;
  updated_at: string;
}

// One row of a bulk upload result (Batch 7): added, skipped as a duplicate,
// or failed with its reason.
export interface BulkUploadRow {
  row: number;
  status: 'added' | 'skipped' | 'error';
  learner_id: string;
  message: string;
}

export interface BulkUploadResult {
  summary: { added: number; skipped: number; failed: number; total: number };
  results: BulkUploadRow[];
}

export interface ScheduleDay {
  date: string;
  day_of_week: number;
  day_name: string;
}

export interface ScheduleMeeting extends Meeting {
  date: string;
}

export interface ScheduleResponse {
  week_start: string;
  week_end: string;
  days: ScheduleDay[];
  meetings: ScheduleMeeting[];
}

// ---------- Attendance (Batch 3) ----------

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';
export type AttendanceMethod = 'manual' | 'qr';

export interface AttendanceMark {
  status: AttendanceStatus;
  time_in: string | null; // "07:32" or null for absent/excused
  method: AttendanceMethod;
}

export interface AttendanceRow {
  id: number;
  first_name: string;
  last_name: string;
  learner_id: string;
  sex: 'Male' | 'Female';
  mark: AttendanceMark | null;
}

export interface AttendanceRoll {
  class: ClassItem;
  date: string; // YYYY-MM-DD
  saved: boolean;
  saved_at: string | null; // ISO timestamp of the last save, or null
  learners: AttendanceRow[];
}

export interface AttendanceLookup {
  learner: Learner;
  class: {
    id: number;
    subject_name: string;
    grade_level: number;
    section_name: string;
  };
  date: string;
  mark: AttendanceMark | null;
}

export interface Sf2Day {
  date: string; // YYYY-MM-DD
  day: number;
  weekday: string; // M, T, W, TH, F
}

export interface Sf2Learner {
  id: number;
  first_name: string;
  last_name: string;
  learner_id: string;
  sex: 'Male' | 'Female';
  marks: Record<string, AttendanceStatus>; // date -> status. Only days
  // today or earlier carry a mark: a day after today has none, and a past
  // day with no saved roll marks 'absent'.
  // Present and Absent count saved-roll marks only: present/late marks
  // count present, absent marks and unmarked past days count absent,
  // excused days count in neither total, future days in neither.
  totals: { present: number; absent: number };
}

// One group of the SF2 footer summary table: the form's own formulas, to
// one decimal. percentage_of_attendance is null when there is nothing to
// divide by, and the form leaves it blank.
export interface Sf2SummaryGroup {
  registered: number;
  average_daily_attendance: number;
  percentage_of_attendance: number | null;
  absent_five_days: number;
}

export interface Sf2Summary {
  days_of_classes: number;
  male: Sf2SummaryGroup;
  female: Sf2SummaryGroup;
  total: Sf2SummaryGroup;
}

// A weekday in the month that is not a school day: before the first day
// of classes, after the last day, or a holiday the teacher entered.
// `name` carries the holiday name, or null for the other two reasons.
export interface Sf2NonSchoolDay {
  date: string; // YYYY-MM-DD
  day: number;
  weekday: string; // M, T, W, TH, F
  reason: 'before_first_day' | 'after_last_day' | 'holiday';
  name: string | null;
}

export interface Sf2Report {
  class: ClassItem;
  month: string; // YYYY-MM
  month_label: string; // JULY
  school_year: string; // 2026 - 2027
  adviser_name: string | null;
  school: {
    name: string | null;
    region: string | null;
    division: string | null;
    deped_school_id: string | null;
    school_head_name: string | null;
  };
  days: Sf2Day[];
  non_school_days: Sf2NonSchoolDay[];
  learners: Sf2Learner[];
  // The last table row: learners present per day, and the month's totals.
  // A day after today is null: the total is not computed for a date that
  // has not happened yet, and the form shows it blank, never 0.
  combined: {
    present_by_day: Record<string, number | null>;
    totals: { present: number; absent: number };
  };
  // One TOTAL Per Day row per gender, after that gender's learners. A
  // gender with no learners is null and gets no row.
  totals_by_gender: {
    male: {
      present_by_day: Record<string, number | null>;
      totals: { present: number; absent: number };
    } | null;
    female: {
      present_by_day: Record<string, number | null>;
      totals: { present: number; absent: number };
    } | null;
  };
  summary: Sf2Summary;
}

// ---------- Grades and Consolidation (Batch 4) ----------

export interface GradeColumn {
  id: number;
  class_id: number;
  quarter: number;
  component: 'WW' | 'PT' | 'EX';
  name: string;
  highest_possible: number;
  position: number;
  // The share of the Examinations component (ST1 30, ST2 30, Term Exam 40),
  // or null for WW/PT and for columns made under DO 8.
  sub_weight: number | null;
  // The display name of a default Examinations column ("Summative Test 1"),
  // or null.
  label: string | null;
  // A column filled by an online quiz: the quiz that owns it, or null for
  // a column typed in by hand on the Grades page.
  quiz_id?: number | null;
  quiz_title?: string | null;
  // A column filled by a checked paper exam: the exam that owns it, or
  // null for a column typed in by hand on the Grades page.
  exam_id?: number | null;
  exam_title?: string | null;
}

export interface GradeWeights {
  ww: number;
  pt: number;
  ex: number;
  // The teacher-set lowest grade for the class; the profile's own floor
  // when the teacher has not set one.
  floor?: number;
}

export interface GradeComponentGrade {
  total: number;
  maxTotal: number;
  ps: number | null;
  ws: number | null;
  entered: number;
  count: number;
}

export interface GradeComputed {
  components: Record<'WW' | 'PT' | 'EX', GradeComponentGrade>;
  complete: boolean;
  entered: number;
  cells: number;
  initial: number | null;
  qg: number | null; // the grade on the card: the term grade under DO 015, the quarterly grade under DO 8
  descriptor: string | null;
  status: string;
}

export interface GradeLearnerRow {
  id: number;
  first_name: string;
  last_name: string;
  learner_id: string;
  sex: 'Male' | 'Female';
  scores: Record<number, number | null>;
  computed: GradeComputed;
}

export interface GradeStats {
  mps: number | null;
  passing_rate: number | null;
  highest_transmuted: number | null;
  intervention_count: number;
  intervention: string[];
  encoding_pct: number;
  complete_count: number;
  total_learners: number;
}

export interface GradeSubmission {
  id: number;
  class_id: number;
  quarter: number;
  academic_year: string;
  submitted_by: number;
  submitted_at: string;
  // The grading system the filing was made under; a filed grade keeps it.
  profile?: string;
}

export interface GradeReminder {
  active: boolean;
  reminded_at: string | null;
  adviser_name: string | null;
}

export interface GradeSheet {
  class: ClassItem;
  quarter: number;
  academic_year: string;
  grading: GradingInfo;
  columns: GradeColumn[];
  weights: GradeWeights;
  learners: GradeLearnerRow[];
  stats: GradeStats;
  submission: GradeSubmission | null;
  // Every period already filed for this class and year (the period tabs
  // mark the filed ones).
  submitted_periods: number[];
  // Final grades for this class, from the SAVED scores of every period:
  // the mean of the saved period grades, keyed by learner id, once every
  // period has a complete saved record for that learner. Null means no
  // final grade yet. period_grades carries the saved grade of each period
  // per learner (null when that period has no complete saved record), so
  // the Final Grades tab can show every period side by side. filed_periods
  // is the number of periods with a filing (submitted_periods says which);
  // filing is what sends grades to Consolidation and the Report Card, which
  // stay filed-only.
  finals: {
    filed_periods: number;
    total_periods: number;
    grades: Record<number, number | null>;
    period_grades: Record<number, Record<number, number | null>>;
  };
  reminder: GradeReminder;
  // True when the teacher is both the subject teacher and the adviser of
  // this class: the button reads "Move to Consolidation" instead of
  // "Submit to adviser", and the grades file straight into Consolidation.
  direct_add: boolean;
}

export interface SubmissionCheck {
  quarter: number;
  academic_year: string;
  grading: GradingInfo;
  total_learners: number;
  complete_learners: number;
  incomplete_learners: number;
  entered_cells: number;
  total_cells: number;
  encoding_pct: number;
  incomplete_names: string[];
  intervention: string[];
  submitted: boolean;
  submitted_at: string | null;
}

export interface ConsolidationSubject {
  class_id: number | null; // the class the Remind action goes to (first unfiled class of the subject)
  subject_name: string;
  teacher_name: string;
  submitted: boolean;
  submitted_at: string | null;
  average: number | null;
  reminded: boolean;
  reminded_at: string | null;
  // True when the teacher who still needs to file is the adviser themself:
  // a direct-add needs no reminder, so the Remind button is hidden.
  own_class: boolean;
  // A manual subject (Batch 8 fix 10): created by the adviser when the
  // subject teacher has no AcadSync account, with grades uploaded as a CSV.
  // A merged subject (a real class and a manual subject with the same name)
  // is manual too — its manual grades fill periods with no real filing.
  manual: boolean;
  manual_subject_id: number | null;
  profile_code: string | null;
}

// A manual subject in Consolidation (Batch 8 fix 10): the adviser creates
// the subject when its teacher has no AcadSync account. The teacher's name
// is plain display text — no account is created for them. Grades arrive by
// CSV upload and are counted like filed grades.
export interface ManualSubject {
  id: number;
  subject_name: string;
  teacher_name: string;
  grade_level: number;
  section_name: string;
  academic_year: string;
  profile_code: string;
  grade_count: number;
  periods_with_grades: number[];
  created_at: string;
  updated_at: string;
}

export interface ManualGradesFileResponse {
  manual_subject: ManualSubject;
  filed: number;
}

// ---------- Online quizzes (Batch 9) ----------

export type QuizStatus = 'draft' | 'published' | 'closed';
export type QuizQuestionType = 'mcq' | 'true_false';

export interface Quiz {
  id: number;
  teacher_id: number;
  class_id: number;
  quarter: number;
  quiz_number: number;
  title: string;
  instructions: string;
  status: QuizStatus;
  code: string;
  deadline: string | null;
  grade_column_id: number | null;
  created_at: string;
  updated_at: string;
  subject_name: string;
  grade_level: number;
  section_name: string;
  academic_year: string;
  question_count: number;
  attempt_count: number;
  total_points: number;
}

export interface QuizQuestion {
  id: number;
  quiz_id: number;
  position: number;
  question_type: QuizQuestionType;
  question_text: string;
  options: string[];
  // The answer key. Present on the teacher's detail read, never on the
  // public read a learner sees.
  correct_index?: number;
  points: number;
}

export interface QuizQuestionForm {
  question_type: QuizQuestionType;
  question_text: string;
  options: string[];
  correct_index: number;
  points: number;
}

export interface QuizRosterRow {
  id: number;
  first_name: string;
  last_name: string;
  learner_id: string;
  sex: 'Male' | 'Female';
  attempt: { score: number; total_points: number; submitted_at: string } | null;
}

export interface QuizAttemptRow {
  id: number;
  learner_id: number;
  first_name: string;
  last_name: string;
  learner_code: string;
  score: number;
  total_points: number;
  submitted_at: string;
}

export interface QuizDetail {
  quiz: Quiz;
  grading: GradingInfo;
  questions: QuizQuestion[];
  roster: QuizRosterRow[];
  attempts: QuizAttemptRow[];
  question_stats: { question_id: number; attempts: number; correct: number }[];
}

// What a learner sees at the shared link: the quiz's details and its
// questions, without the answer key.
export interface PublicQuiz {
  quiz: {
    code: string;
    title: string;
    instructions: string;
    status: QuizStatus;
    deadline: string | null;
    quiz_number: number;
    quarter: number;
    period_label: string;
    total_points: number;
    question_count: number;
    teacher_name: string;
    class: { subject_name: string; grade_level: number; section_name: string; academic_year: string };
    open: boolean;
  };
  questions: QuizQuestion[];
}

export interface QuizLookup {
  learner: { first_name: string; last_name: string; learner_id: string; sex: 'Male' | 'Female' };
  already_submitted: boolean;
  attempt: { score: number; total_points: number; submitted_at: string } | null;
  open: boolean;
}

export interface QuizSubmitResult {
  score: number;
  total_points: number;
  correct_count: number;
  total_questions: number;
  submitted_at: string;
  learner_name: string;
  message: string;
}

// ---------- Paper exam checker (Batch 10) ----------
// Choices per question, one answer key for the whole exam, and one
// printed answer sheet per learner. The photo of a sheet is read in
// the browser and never uploaded: only the reviewed answers reach the
// server, and the server recomputes the score from its key.
export type ExamQuestionKind = 'mcq' | 'true_false';

export interface ExamQuestion {
  choices: number;
  correct: number | null;
  kind: ExamQuestionKind;
}

export interface Exam {
  id: number;
  teacher_id: number;
  class_id: number;
  quarter: number;
  exam_number: number;
  title: string;
  instructions: string;
  question_count: number;
  points_each: number;
  questions: ExamQuestion[];
  key_complete: boolean;
  total_points: number;
  grade_column_id: number | null;
  created_at: string;
  updated_at: string;
  subject_name: string;
  grade_level: number;
  section_name: string;
  academic_year: string;
  scan_count: number;
}

export interface ExamScanAnswer {
  selected: number | null;
  uncertain: boolean;
  multiple: boolean;
}

export interface ExamRosterRow {
  id: number;
  first_name: string;
  last_name: string;
  learner_id: string;
  sex: 'Male' | 'Female';
  scan: { score: number; total_points: number; source: 'photo' | 'manual'; updated_at: string } | null;
}

export interface ExamScanRow {
  id: number;
  learner_id: number;
  first_name: string;
  last_name: string;
  learner_code: string;
  score: number;
  total_points: number;
  answers: ExamScanAnswer[];
  source: 'photo' | 'manual';
  created_at: string;
  updated_at: string;
}

export interface ExamDetail {
  exam: Exam;
  grading: GradingInfo;
  roster: ExamRosterRow[];
  scans: ExamScanRow[];
  question_stats: { position: number; attempts: number; correct: number }[];
}

// ---------- Test Item Analysis (Batch 12) ----------
// Computed by the API from the saved checked sheets, every time it is
// read. Difficulty and discrimination follow the bands printed on the
// teacher's Test Item Analysis sheet; a distractor is judged on the
// sheet's two rules — chosen by at least 5% of takers, and by more
// lower-group than upper-group learners.
export interface ItemAnalysisDistractor {
  option_index: number;
  label: string;
  is_correct: boolean;
  upper: number;
  lower: number;
  total: number;
  plausibility: number;
  direction: number;
  remark: string;
  action: string;
  plausibility_remark: string;
  direction_remark: string;
}

export interface ItemAnalysisItem {
  position: number;
  kind: ExamQuestionKind;
  choices: number;
  correct: number | null;
  correct_label: string;
  upper_correct: number;
  lower_correct: number;
  total_correct: number;
  blank_count: number;
  difficulty: number | null;
  difficulty_label: string;
  difficulty_action: string;
  discrimination: number | null;
  discrimination_label: string;
  discrimination_action: string;
  negative: boolean;
  distractors: ItemAnalysisDistractor[];
}

export interface ItemAnalysis {
  exam: Exam;
  grading: GradingInfo;
  header: {
    teacher_name: string | null;
    school_name: string | null;
    school_city_region: string | null;
    region: string | null;
    division: string | null;
    deped_school_id: string | null;
    school_head_name: string | null;
    has_school_seal: boolean;
  };
  roster_size: number;
  takers: number;
  groups: { method: string; upper_size: number; lower_size: number; tie_note: string };
  ready: boolean;
  mean_score: number | null;
  mean_percent: number | null;
  total_points: number;
  items: ItemAnalysisItem[];
  summary: {
    difficulty_counts: Record<string, number>;
    discrimination_counts: Record<string, number>;
    distractor_counts: { retain: number; rephrase: number; replace: number };
    negative_items: number[];
    most_learned: number[];
    least_learned: number[];
  };
}

// ---------- Lesson plans (Batch 11) ----------
// One ILAW lesson plan: the header is filled from the teacher's record
// and class, and every section of the DepEd template is one text field.
// Answer keys sit beside the activity they belong to. The AI declaration
// is required on every plan (DO 3, s. 2026, Annex A).
export type LessonPlanStatus = 'draft' | 'ready' | 'taught';
export type LessonPlanAiUse = 'none' | 'used';

export interface LessonPlan {
  id: number;
  teacher_id: number;
  class_id: number;
  quarter: number;
  week_number: number;
  session_date: string;
  lesson_title: string;
  references: string;
  ai_use: LessonPlanAiUse;
  ai_declaration: string;
  competency: string;
  objective_knowledge: string;
  objective_skill: string;
  objective_attitude: string;
  objective_values: string;
  learner_context: string;
  pre_lesson: string;
  flow: string;
  individual_activity: string;
  individual_answers: string;
  group_activity: string;
  group_answers: string;
  inclusion_strategy: string;
  practical_applications: string;
  generalizations: string;
  abstraction: string;
  learning_resources: string;
  integration: string;
  formative_assessment: string;
  formative_answer_key: string;
  extended_learning: string;
  extended_answer_key: string;
  reflections: string;
  checked_by_name: string | null;
  status: LessonPlanStatus;
  created_at: string;
  updated_at: string;
  subject_name: string;
  grade_level: number;
  section_name: string;
  academic_year: string;
  room: string;
  period_label: string;
}

// The editor form: the header plus every section, with the checked-by
// name as plain text (blank means the school head from the Profile).
export type LessonPlanForm = Omit<LessonPlan, 'id' | 'teacher_id' | 'created_at' | 'updated_at' | 'subject_name' | 'grade_level' | 'section_name' | 'academic_year' | 'room' | 'period_label'> & {
  checked_by_name: string;
};

// The school header for the printout, from the teacher's own record —
// null until the teacher fills it in on their Profile page.
export interface LessonPlanHeader {
  teacher_name: string | null;
  region: string | null;
  division: string | null;
  deped_school_id: string | null;
  school_head_name: string | null;
  school_name: string | null;
  school_city_region: string | null;
}

export interface LessonPlanDetail {
  plan: LessonPlan;
  grading: GradingInfo;
  header: LessonPlanHeader;
}

export interface ConsolidationLearner {
  learner_id: string;
  first_name: string;
  last_name: string;
  sex: 'Male' | 'Female';
  grades: Record<string, number | null>;
  gwa: number | null;
  gwa_reason: string | null;
  honors: string | null;
  at_risk: boolean;
  standing: string;
  rank: number | null;
}

export interface ConsolidationView {
  has_advisory: boolean;
  academic_year: string;
  grading: GradingInfo;
  grade: number | null;
  section: string | null;
  quarter: number;
  readiness: {
    submitted: number;
    total: number;
    pct: number;
  };
  kpis: {
    class_gwa: number | null;
    subject_average: number | null;
    honor_count: number;
    honor_pct: number;
    at_risk_count: number;
  };
  subjects: ConsolidationSubject[];
  learners: ConsolidationLearner[];
}

// Final grades across the year's periods: each subject's final grade is the
// mean of its period grades, and the final GWA is the mean of the final
// grades. This is the same final grade the Report Card (Batch 5) prints.
export interface ConsolidationFinalSubject {
  subject_name: string;
  teacher_name: string;
  filed_periods: number;
  total_periods: number;
  average: number | null;
  // A manual subject (Batch 8 fix 10) — see ConsolidationSubject.
  manual: boolean;
  manual_subject_id: number | null;
  profile_code: string | null;
}

export interface ConsolidationFinalLearner {
  learner_id: string;
  first_name: string;
  last_name: string;
  sex: 'Male' | 'Female';
  grades: Record<string, number | null>;
  gwa: number | null;
  gwa_reason: string | null;
  honors: string | null;
  at_risk: boolean;
  standing: string;
  rank: number | null;
}

export interface ConsolidationFinals {
  has_data: boolean;
  academic_year: string;
  grading: GradingInfo;
  periods: number[];
  period_label: string;
  subjects: ConsolidationFinalSubject[];
  learners: ConsolidationFinalLearner[];
  readiness: {
    complete: number;
    total: number;
    pct: number;
  };
  kpis: {
    class_gwa: number | null;
    honor_count: number;
    at_risk_count: number;
  };
}

export interface ConsolidationReadiness {
  has_advisory: boolean;
  grade: number | null;
  section: string | null;
  quarter: number;
  academic_year: string;
  grading: GradingInfo;
  submitted: number;
  total: number;
  pct: number;
}

// ---------- Report Card (Batch 5) ----------
// One card per learner in the adviser's section, filled from the consolidated
// grades and the attendance records. The API returns everything the card
// prints; the page displays it and saves the teacher's comments.
export interface ReportCardDescriptor {
  range: string;
  descriptor: string;
  remarks: string;
}

export interface ReportCardMonth {
  key: string; // "2026-06"
  label: string; // "Jun"
}

export interface ReportCardAttendanceMonth {
  class_days: number;
  present: number;
  absent: number;
  excused: number;
}

export interface ReportCardSubject {
  subject_name: string;
  teacher_name: string;
}

export interface ReportCardLearnerSubject {
  subject_name: string;
  period_grades: (number | null)[];
  final_grade: number | null;
  remarks: string | null;
}

export interface ReportCardLearner {
  learner_id: string;
  first_name: string;
  last_name: string;
  sex: 'Male' | 'Female';
  age: number | null;
  subjects: ReportCardLearnerSubject[];
  general_average: number | null;
  general_average_remarks: string | null;
  attendance: {
    months: Record<string, ReportCardAttendanceMonth | null>;
    totals: ReportCardAttendanceMonth | null;
  };
  comments: Record<string, string>;
}

export interface ReportCardView {
  has_advisory: boolean;
  adviser: { grade: number; section: string; name: string };
  school_name: string;
  school_head_name: string;
  // Whether the school has an uploaded seal, printed on the right side
  // of the card front. The image itself comes from its own endpoint.
  has_school_seal: boolean;
  academic_year: string;
  grading: GradingInfo;
  descriptors: ReportCardDescriptor[];
  months: ReportCardMonth[];
  subjects: ReportCardSubject[];
  learners: ReportCardLearner[];
}

export interface PublicSchool {
  id: number;
  name: string;
  city_region: string;
}

export interface TeacherSession {
  token: string;
  teacher: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    username: string;
    must_change_password: boolean;
  };
}

// Field name -> message, as returned by the API for form mistakes.
export type FieldErrors = Record<string, string>;
