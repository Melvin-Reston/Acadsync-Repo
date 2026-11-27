// Payments & Invoices (Teacher Batch 6): the teacher's own plan, the active plans,
// their invoices, and the receipt for one invoice — paid by scanning the
// administrator's QR code, with a screenshot and a reference number sent for
// confirmation. The page displays what the API returns and never invents a
// price, a date or a status. Receipt-first, after the chosen design: the
// receipt is the centre of the page and the payment steps follow from it.
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  errorMessage,
  fieldErrors,
  invoiceStatusLabel,
  invoiceStatusTone,
  manilaNow,
  paymentStatusLabel,
  paymentStatusTone,
  peso,
  planPrice,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from '../../../core/helpers';
import {
  FieldErrors,
  Plan,
  TeacherInvoicePayment,
  TeacherInvoiceRow,
  TeacherSubscription,
} from '../../../core/models';
import { PaymentInfo, TeacherPortalService } from '../../../core/teacher-portal.service';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-teacher-payments',
  imports: [DatePipe, FormsModule, IconComponent],
  templateUrl: './teacher-payments.component.html',
  styleUrl: './teacher-payments.component.css',
})
export class TeacherPaymentsComponent {
  private readonly portal = inject(TeacherPortalService);
  private readonly toast = inject(ToastService);

  protected readonly subscription = signal<TeacherSubscription | null>(null);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly invoices = signal<TeacherInvoiceRow[]>([]);
  protected readonly paymentInfo = signal<PaymentInfo | null>(null);
  protected readonly qrUrl = signal<string | null>(null);
  protected readonly qr2Url = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly formErrors = signal<FieldErrors>({});

  // The receipt on screen: one invoice, with its payment history.
  protected readonly selectedInvoiceId = signal<number | null>(null);
  protected readonly receipt = signal<{ invoice: TeacherInvoiceRow; payments: TeacherInvoicePayment[] } | null>(null);
  protected readonly receiptLoading = signal(false);

  // Changing plan is two steps: pick, then confirm.
  protected readonly confirmingPlanId = signal<number | null>(null);
  protected readonly changingPlan = signal(false);

  // The pay form, for the invoice on the receipt.
  protected referenceNumber = '';
  protected paidOn = manilaNow().date;
  protected readonly today = manilaNow().date;
  protected note = '';
  protected screenshot: File | null = null;
  protected screenshotName = '';
  protected readonly submittingPayment = signal(false);

  protected readonly peso = peso;
  protected readonly planPrice = planPrice;
  protected readonly subscriptionStatusLabel = subscriptionStatusLabel;
  protected readonly subscriptionStatusTone = subscriptionStatusTone;
  protected readonly invoiceStatusTone = invoiceStatusTone;

  // The earliest invoice the teacher still has to pay, if any.
  protected readonly unpaidInvoice = computed(() => {
    const unpaid = this.invoices().filter((invoice) => invoice.status === 'unpaid');
    unpaid.sort((a, b) => a.due_date.localeCompare(b.due_date));
    return unpaid[0] ?? null;
  });

  // A payment on the unpaid invoice is waiting for the administrator.
  protected readonly waitingInvoice = computed(() =>
    this.invoices().find(
      (invoice) => invoice.status === 'unpaid' && invoice.latest_payment_status === 'pending',
    ),
  );

  // The subscription is current while it is on trial, active or past due.
  protected readonly hasCurrentSubscription = computed(() => {
    const status = this.subscription()?.status;
    return status === 'trial' || status === 'active' || status === 'past_due';
  });

  // Whole days until the trial ends, or the period ends. Never negative.
  protected readonly daysLeft = computed(() => {
    const subscription = this.subscription();
    if (!subscription) return null;
    const end =
      subscription.status === 'trial' && subscription.trial_ends_at
        ? subscription.trial_ends_at
        : subscription.current_period_end;
    const today = new Date(`${manilaNow().date}T00:00:00`).getTime();
    const days = Math.ceil((new Date(end).getTime() - today) / 86400000);
    return Math.max(days, 0);
  });

  protected readonly selectedInvoice = computed(() => {
    const id = this.selectedInvoiceId();
    return id === null ? null : this.invoices().find((invoice) => invoice.id === id) ?? null;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    forkJoin({
      subscription: this.portal.subscription(),
      plans: this.portal.activePlans(),
      invoices: this.portal.myInvoices(),
      paymentInfo: this.portal.paymentInfo(),
    }).subscribe({
      next: (result) => {
        this.loading.set(false);
        this.subscription.set(result.subscription.subscription);
        this.plans.set(result.plans.items);
        this.invoices.set(result.invoices.items);
        this.paymentInfo.set(result.paymentInfo);
        if (result.paymentInfo.has_qr) this.loadQr();
        if (result.paymentInfo.has_qr2) this.loadQr2();
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  private loadQr(): void {
    this.portal.paymentQr().subscribe({
      next: (blob) => {
        const old = this.qrUrl();
        if (old) URL.revokeObjectURL(old);
        this.qrUrl.set(URL.createObjectURL(blob));
      },
      error: () => this.qrUrl.set(null),
    });
  }

  private loadQr2(): void {
    this.portal.paymentQr2().subscribe({
      next: (blob) => {
        const old = this.qr2Url();
        if (old) URL.revokeObjectURL(old);
        this.qr2Url.set(URL.createObjectURL(blob));
      },
      error: () => this.qr2Url.set(null),
    });
  }

  // At least one QR code is set. A teacher pays with either one; the
  // screenshot and reference number sent for confirmation are the same.
  protected readonly hasAnyQr = computed(() => {
    const info = this.paymentInfo();
    return Boolean(info?.has_qr || info?.has_qr2);
  });

  // The label the administrator gave a QR code, or "Payment option 1/2"
  // when both are set and a label is blank. With a single QR code and no
  // label, there is nothing to distinguish, so no heading is shown.
  protected qrLabel(second = false): string {
    const info = this.paymentInfo();
    if (!info) return '';
    const label = second ? info.qr2_label : info.label;
    if (label) return label;
    if (info.has_qr && info.has_qr2) return second ? 'Payment option 2' : 'Payment option 1';
    return '';
  }

  // What happens next with the teacher's plan, in plain words.
  protected nextStep(): string {
    const subscription = this.subscription();
    const invoice = this.unpaidInvoice();
    const waiting = this.waitingInvoice();
    if (!subscription) return 'No plan yet. Choose one below to get started.';
    if (subscription.status === 'trial' && subscription.trial_ends_at) {
      return `Trial ends ${this.date(subscription.trial_ends_at)}. Then ${peso(subscription.price)} is due.`;
    }
    if (subscription.status === 'past_due' && waiting) {
      return `Your payment for invoice ${waiting.invoice_number} is waiting for confirmation.`;
    }
    if (subscription.status === 'past_due' && invoice) {
      return `Invoice ${invoice.invoice_number} for ${peso(invoice.amount)} is unpaid, due ${this.date(invoice.due_date)}. If it is not paid by then, the subscription expires.`;
    }
    if (subscription.status === 'active') {
      if (Number(subscription.price) === 0) {
        return `Your free period ends ${this.date(subscription.current_period_end)}. After that, Teacher Pro is a paid plan.`;
      }
      return subscription.billing_cycle === 'one_time'
        ? `Ends ${this.date(subscription.current_period_end)}.`
        : `Renews ${this.date(subscription.current_period_end)}.`;
    }
    if (subscription.status === 'expired') {
      return 'Your plan has ended. Choose a plan below to start a new one.';
    }
    return `Ended ${this.date(subscription.current_period_end)}.`;
  }

  protected invoiceLabel(invoice: TeacherInvoiceRow): string {
    if (invoice.status === 'unpaid' && invoice.latest_payment_status === 'pending') {
      return 'Waiting for confirmation';
    }
    return invoiceStatusLabel(invoice.status, invoice.is_overdue);
  }

  protected invoiceTone(invoice: TeacherInvoiceRow): string {
    if (invoice.status === 'unpaid' && invoice.latest_payment_status === 'pending') {
      return 'amber';
    }
    return invoiceStatusTone(invoice.status, invoice.is_overdue);
  }

  protected paymentLabel(payment: TeacherInvoicePayment): string {
    return paymentStatusLabel(payment.status);
  }

  protected paymentTone(payment: TeacherInvoicePayment): string {
    return paymentStatusTone(payment.status);
  }

  protected isCurrentPlan(plan: Plan): boolean {
    return this.subscription()?.plan_id === plan.id && this.hasCurrentSubscription();
  }

  protected isFreeSubscription(subscription: { price: string }): boolean {
    return Number(subscription.price) === 0;
  }

  // Whether a trial is still available to this teacher: the one free
  // window (from their first subscription) has not ended yet. A teacher
  // with no subscription yet has the whole window ahead of them.
  protected trialAvailable(): boolean {
    const end = this.subscription()?.window_ends_at;
    return !end || new Date(end).getTime() > Date.now();
  }

  // Teacher Free can only ever be the first plan: once the teacher has
  // had any subscription, Free is no longer offered, unless it is the
  // plan they are on now. The backend refuses it too.
  protected showPlan(plan: Plan): boolean {
    if (Number(plan.price) !== 0) return true;
    if (this.isCurrentPlan(plan)) return true;
    return !this.subscription();
  }

  // Open the receipt for one invoice, and scroll it into view.
  protected openReceipt(invoice: TeacherInvoiceRow): void {
    this.selectedInvoiceId.set(invoice.id);
    this.receipt.set(null);
    this.receiptLoading.set(true);
    this.resetPayForm();
    this.portal.myInvoice(invoice.id).subscribe({
      next: (receipt) => {
        this.receiptLoading.set(false);
        this.receipt.set(receipt);
        document.getElementById('receipt')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
      error: (error) => {
        this.receiptLoading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected closeReceipt(): void {
    this.selectedInvoiceId.set(null);
    this.receipt.set(null);
    this.resetPayForm();
  }

  // The receipt can take a payment while the invoice is unpaid and no payment
  // is already waiting. A rejected payment leaves the invoice unpaid, so the
  // teacher can send a new one.
  protected canPay(invoice: TeacherInvoiceRow): boolean {
    return invoice.status === 'unpaid' && invoice.latest_payment_status !== 'pending';
  }

  protected onScreenshot(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.screenshot = file;
    this.screenshotName = file ? file.name : '';
    const errors = { ...this.formErrors() };
    if (file && file.size > MAX_SCREENSHOT_BYTES) {
      errors['screenshot'] = 'The image is too large. The limit is 2 MB.';
    } else {
      delete errors['screenshot'];
    }
    this.formErrors.set(errors);
  }

  protected submitPayment(): void {
    const invoice = this.selectedInvoice();
    if (!invoice || !this.canPay(invoice)) return;
    const errors: FieldErrors = {};
    if (!this.referenceNumber.trim()) {
      errors['reference_number'] = 'Enter the reference number from your payment.';
    }
    if (!this.screenshot) {
      errors['screenshot'] = 'Attach a screenshot of your payment.';
    } else if (this.screenshot.size > MAX_SCREENSHOT_BYTES) {
      errors['screenshot'] = 'The image is too large. The limit is 2 MB.';
    }
    this.formErrors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.submittingPayment.set(true);
    this.portal
      .submitPayment(invoice.id, {
        reference_number: this.referenceNumber.trim(),
        paid_on: this.paidOn,
        note: this.note.trim(),
        screenshot: this.screenshot,
      })
      .subscribe({
        next: (response) => {
          this.submittingPayment.set(false);
          this.toast.success(response.message || 'Payment sent.');
          this.resetPayForm();
          this.refreshAfterPayment(invoice.id);
        },
        error: (error) => {
          this.submittingPayment.set(false);
          this.formErrors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  private refreshAfterPayment(invoiceId: number): void {
    this.portal.myInvoices().subscribe({
      next: (response) => this.invoices.set(response.items),
      error: () => undefined,
    });
    this.portal.myInvoice(invoiceId).subscribe({
      next: (receipt) => this.receipt.set(receipt),
      error: () => undefined,
    });
  }

  private resetPayForm(): void {
    this.referenceNumber = '';
    this.paidOn = manilaNow().date;
    this.note = '';
    this.screenshot = null;
    this.screenshotName = '';
    this.formErrors.set({});
  }

  // Change plan, or choose a plan when there is no current subscription.
  // The first click asks for confirmation; the second one sends it.
  protected planAction(plan: Plan): void {
    if (this.confirmingPlanId() !== plan.id) {
      this.confirmingPlanId.set(plan.id);
      return;
    }
    this.confirmingPlanId.set(null);
    this.changingPlan.set(true);
    const request = this.hasCurrentSubscription()
      ? this.portal.changePlan(plan.id)
      : this.portal.choosePlan(plan.id);
    request.subscribe({
      next: (response) => {
        this.changingPlan.set(false);
        this.subscription.set(response.subscription);
        this.toast.success(
          response.subscription.status === 'trial'
            ? `You are on ${plan.name}. Your trial has started.`
            : `You are now on ${plan.name}.`,
        );
        this.load();
      },
      error: (error) => {
        this.changingPlan.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected cancelPlanConfirm(): void {
    this.confirmingPlanId.set(null);
  }

  private date(value: string): string {
    return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
