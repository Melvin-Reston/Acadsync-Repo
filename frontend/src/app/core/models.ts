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
  account_name: string;
  instructions: string;
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
}

export interface GradeWeights {
  ww: number;
  pt: number;
  ex: number;
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
  // Final grades for this class, from filed submissions only: the mean of
  // the filed period grades, keyed by learner id, once every period is
  // filed. Null means no final grade yet. period_grades carries the filed
  // grade of each period per learner (null when that period is not filed),
  // so the Final Grades tab can show every period side by side.
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
