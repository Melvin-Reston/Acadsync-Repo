// Small helpers used by many pages.
import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import {
  ActivityRole,
  Audience,
  BillingCycle,
  FieldErrors,
  InvoiceStatus,
  PaymentStatus,
  Plan,
  SubscriptionStatus,
} from './models';

// Turns any failed request into a message a person can read.
export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'Cannot reach the server. Check that the backend is running.';
    }
    if (error.error && typeof error.error.message === 'string') {
      return error.error.message;
    }
  }
  return 'Something went wrong. Please try again.';
}

// The per-field messages from a failed request, or an empty object.
export function fieldErrors(error: unknown): FieldErrors {
  if (error instanceof HttpErrorResponse && error.error && error.error.errors) {
    return error.error.errors as FieldErrors;
  }
  return {};
}

// Builds ?search=...&page=... and leaves out empty values.
export function toParams(values: Record<string, string | number | null | undefined>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

export function roleLabel(role: ActivityRole): string {
  if (role === 'system') {
    return 'Automatic';
  }
  return role === 'super_user' ? 'Super User' : 'Admin';
}

// ---------- Money, plans and statuses ----------

// "100.00" -> "₱100.00", "1250.5" -> "₱1,250.50". Always two decimals.
export function peso(amount: string | number | null | undefined): string {
  const value = Number(amount ?? 0);
  return '₱' + value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function billingCycleLabel(cycle: BillingCycle): string {
  return { monthly: 'Monthly', yearly: 'Yearly', one_time: 'One time' }[cycle];
}

// "₱100.00 / month", "₱1,000.00 / year", or "₱0.00 · 1 month only".
// Subscriptions snapshot price and cycle but not duration, so a one-time
// plan without a duration is shown as one month (Teacher Free is 1 month).
export function planPrice(
  plan: Pick<Plan, 'price' | 'billing_cycle'> & { duration_months?: number },
): string {
  if (plan.billing_cycle === 'monthly') {
    return `${peso(plan.price)} / month`;
  }
  if (plan.billing_cycle === 'yearly') {
    return `${peso(plan.price)} / year`;
  }
  const duration = plan.duration_months ?? 1;
  const months = duration === 1 ? '1 month' : `${duration} months`;
  return `${peso(plan.price)} · ${months} only`;
}

export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'trial',
  'active',
  'past_due',
  'expired',
  'cancelled',
];

export function subscriptionStatusLabel(status: SubscriptionStatus): string {
  return {
    trial: 'Trial',
    active: 'Active',
    past_due: 'Past due',
    expired: 'Expired',
    cancelled: 'Cancelled',
  }[status];
}

// Pill colours: burnt orange = active, brown = trial, amber = waiting, red = problem, plain = ended.
export function subscriptionStatusTone(status: SubscriptionStatus): string {
  return { trial: '', active: 'accent', past_due: 'amber', expired: 'red', cancelled: 'plain' }[
    status
  ];
}

export function invoiceStatusLabel(status: InvoiceStatus, isOverdue = false): string {
  if (status === 'unpaid') {
    return isOverdue ? 'Overdue' : 'Unpaid';
  }
  return status === 'paid' ? 'Paid' : 'Void';
}

export function invoiceStatusTone(status: InvoiceStatus, isOverdue = false): string {
  if (status === 'unpaid') {
    return isOverdue ? 'red' : 'amber';
  }
  return status === 'paid' ? 'accent' : 'plain';
}

export function paymentStatusLabel(status: PaymentStatus): string {
  return { pending: 'Waiting for confirmation', confirmed: 'Confirmed', rejected: 'Rejected' }[
    status
  ];
}

export function paymentStatusTone(status: PaymentStatus): string {
  return { pending: 'amber', confirmed: 'accent', rejected: 'red' }[status];
}

export function audienceLabel(audience: Audience): string {
  return { all: 'All teachers', free: 'Free only', pro: 'Pro only' }[audience];
}

// "07:30" or "07:30:00" -> "7:30 AM".
export function time12(value: string): string {
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = minuteText ?? '00';
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

// The current date and time in Manila (Asia/Manila), the way the API works it out.
// The browser's own clock may be in another timezone, so anything that says "now"
// or "today" — the agenda's Now/Next pills, the agenda day — uses this, not local time.
export function manilaNow(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

// Today as YYYY-MM-DD, for date boxes.
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// Saves a file the API sent (a CSV export) to the Downloads folder.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

// The username the API derives from an email address, so the sign-up form can show it live.
// "mreston103@gmail.com" -> "mreston103".
export function deriveUsername(email: string): string {
  let base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '');
  if (base.length < 3) {
    base = `teacher${base}`;
  }
  if (base.length > 30) {
    base = base.slice(0, 30);
  }
  return base || 'teacher';
}

// Password strength, 0 to 4, for the meter on the sign-up form.
// The API only requires 8 characters with a letter and a number; the rest is guidance.
export function passwordStrength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password) || password.length >= 12) score += 1;
  const label = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score];
  return { score, label };
}

// Friendly names for the activity log.
const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.locked': 'Account locked',
  'profile.update': 'Profile updated',
  'password.change': 'Password changed',
  'password.reset_requested': 'Reset link requested',
  'password.reset_completed': 'Password reset',
  'admin.update': 'Admin account edited',
  'admin.enable': 'Admin account enabled',
  'admin.disable': 'Admin account disabled',
  'admin.reset_password': 'Admin password reset',
  'admin.unlock': 'Admin account unlocked',
  'teacher.create': 'Teacher created',
  'teacher.register': 'Teacher signed up',
  'teacher.update': 'Teacher edited',
  'teacher.restrict': 'Teacher restricted',
  'teacher.unrestrict': 'Teacher unrestricted',
  'teacher.reset_password': 'Teacher password reset',
  'school.create': 'School added',
  'school.update': 'School edited',
  'school.merge': 'Schools merged',
  'settings.academic_year': 'Academic year changed',
  'settings.payment_qr': 'Payment QR code changed',
  'plan.create': 'Plan created',
  'plan.update': 'Plan edited',
  'plan.activate': 'Plan activated',
  'plan.deactivate': 'Plan deactivated',
  'plan.delete': 'Plan deleted',
  'subscription.create': 'Subscription added',
  'subscription.extend': 'Subscription extended',
  'subscription.cancel': 'Subscription cancelled',
  'subscription.change_plan': 'Plan changed',
  'subscription.expire': 'Subscription expired',
  'invoice.issue': 'Invoice issued',
  'invoice.void': 'Invoice voided',
  'payment.record': 'Payment recorded',
  'payment.confirm': 'Payment confirmed',
  'payment.reject': 'Payment rejected',
  'announcement.create': 'Announcement created',
  'announcement.update': 'Announcement edited',
  'announcement.delete': 'Announcement deleted',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// Colour of the pill for an activity entry.
export function actionTone(action: string): string {
  const red = [
    'teacher.restrict',
    'auth.locked',
    'admin.disable',
    'subscription.cancel',
    'subscription.expire',
    'payment.reject',
    'invoice.void',
    'plan.delete',
    'announcement.delete',
  ];
  if (red.includes(action)) {
    return 'red';
  }
  if (action.includes('password') || action === 'school.merge' || action === 'plan.deactivate') {
    return 'amber';
  }
  if (action.startsWith('auth.')) {
    return '';
  }
  return 'accent';
}
