import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  errorMessage,
  fieldErrors,
  invoiceStatusLabel,
  invoiceStatusTone,
  paymentStatusLabel,
  paymentStatusTone,
  peso,
  todayIso,
} from '../../core/helpers';
import { FieldErrors, Invoice, InvoiceTotals, Payment } from '../../core/models';
import {
  InvoiceFilters,
  PaymentFilters,
  PaymentRecord,
  PaymentsService,
} from '../../core/payments.service';
import { ToastService } from '../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { PaginationComponent } from '../../shared/pagination.component';

type View = 'invoices' | 'payments';
type Dialog = 'none' | 'invoice' | 'record' | 'void' | 'payment' | 'reject';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

@Component({
  selector: 'app-payments',
  imports: [FormsModule, RouterLink, DatePipe, DropdownComponent, IconComponent, ModalComponent, PaginationComponent],
  templateUrl: './payments.component.html',
})
export class PaymentsComponent implements OnInit, OnDestroy {
  private readonly paymentsApi = inject(PaymentsService);
  private readonly toast = inject(ToastService);

  // Optional values from the address bar:
  //   /payments?view=payments&status=pending   payments waiting for confirmation
  //   /payments?status=overdue                 overdue invoices
  //   /payments?invoice=12                     opens invoice 12
  readonly view = input('');
  readonly status = input('');
  readonly invoice = input('');

  protected readonly currentView = signal<View>('invoices');

  protected invoiceFilters: InvoiceFilters = { search: '', status: '', from: '', to: '', page: 1, page_size: 10 };
  protected paymentFilters: PaymentFilters = { search: '', status: '', source: '', from: '', to: '', page: 1, page_size: 10 };

  protected readonly invoiceStatusOptions: DropdownOption[] = [
    { value: '', label: 'All statuses' },
    { value: 'unpaid', label: 'Unpaid' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
  ];

  protected readonly paymentStatusOptions: DropdownOption[] = [
    { value: '', label: 'All statuses' },
    { value: 'pending', label: 'Waiting for confirmation' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'rejected', label: 'Rejected' },
  ];

  protected readonly paymentSourceOptions: DropdownOption[] = [
    { value: '', label: 'All payments' },
    { value: 'teacher', label: 'Sent by teacher' },
    { value: 'admin', label: 'Recorded by admin' },
  ];

  protected readonly invoices = signal<Invoice[]>([]);
  protected readonly invoiceTotal = signal(0);
  protected readonly totals = signal<InvoiceTotals | null>(null);
  protected readonly payments = signal<Payment[]>([]);
  protected readonly paymentTotal = signal(0);
  protected readonly pendingCount = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly dialog = signal<Dialog>('none');
  protected readonly dialogError = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly working = signal(false);

  // The invoice or payment that is open in a pop-up.
  protected readonly openInvoice = signal<Invoice | null>(null);
  protected readonly invoicePayments = signal<Payment[]>([]);
  protected readonly openPayment = signal<Payment | null>(null);
  protected readonly screenshotUrl = signal('');

  protected record: PaymentRecord = { reference_number: '', paid_on: todayIso(), note: '', screenshot: null };
  protected reason = '';
  protected readonly today = todayIso();

  protected readonly peso = peso;
  protected readonly invoiceStatusLabel = invoiceStatusLabel;
  protected readonly invoiceStatusTone = invoiceStatusTone;
  protected readonly paymentStatusLabel = paymentStatusLabel;
  protected readonly paymentStatusTone = paymentStatusTone;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    if (this.view() === 'payments') {
      this.currentView.set('payments');
      if (['pending', 'confirmed', 'rejected'].includes(this.status())) {
        this.paymentFilters.status = this.status();
      }
    } else if (['unpaid', 'overdue', 'paid', 'void'].includes(this.status())) {
      this.invoiceFilters.status = this.status();
    }

    this.loadInvoices();
    this.loadPayments();

    if (Number(this.invoice()) > 0) {
      this.showInvoice(Number(this.invoice()));
    }
  }

  ngOnDestroy(): void {
    this.clearScreenshot();
  }

  // ---------- Lists ----------
  protected loadInvoices(): void {
    this.loading.set(true);
    this.error.set('');
    this.paymentsApi.invoices(this.invoiceFilters).subscribe({
      next: (page) => {
        this.invoices.set(page.items);
        this.invoiceTotal.set(page.total);
        this.totals.set(page.totals);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.loading.set(false);
      },
    });
  }

  protected loadPayments(): void {
    this.paymentsApi.payments(this.paymentFilters).subscribe({
      next: (page) => {
        this.payments.set(page.items);
        this.paymentTotal.set(page.total);
        this.pendingCount.set(page.pending_count);
      },
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  private reload(): void {
    this.loadInvoices();
    this.loadPayments();
  }

  protected show(view: View): void {
    this.currentView.set(view);
  }

  protected onSearch(view: View): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.applyFilters(view), 300);
  }

  protected applyFilters(view: View): void {
    if (view === 'invoices') {
      this.invoiceFilters.page = 1;
      this.loadInvoices();
    } else {
      this.paymentFilters.page = 1;
      this.loadPayments();
    }
  }

  protected showInvoices(status: string): void {
    this.invoiceFilters.status = status;
    this.currentView.set('invoices');
    this.applyFilters('invoices');
  }

  protected goToInvoicePage(page: number): void {
    this.invoiceFilters.page = page;
    this.loadInvoices();
  }

  protected goToPaymentPage(page: number): void {
    this.paymentFilters.page = page;
    this.loadPayments();
  }

  protected get hasInvoiceFilters(): boolean {
    const filters = this.invoiceFilters;
    return Boolean(filters.search || filters.status || filters.from || filters.to);
  }

  protected get hasPaymentFilters(): boolean {
    const filters = this.paymentFilters;
    return Boolean(filters.search || filters.status || filters.source || filters.from || filters.to);
  }

  // ---------- Invoice pop-up ----------
  protected showInvoice(id: number): void {
    this.paymentsApi.invoice(id).subscribe({
      next: (response) => {
        this.openInvoice.set(response.invoice);
        this.invoicePayments.set(response.payments);
        this.openDialog('invoice');
      },
      error: (error) => this.toast.error(errorMessage(error)),
    });
  }

  protected openRecord(): void {
    this.record = { reference_number: '', paid_on: todayIso(), note: '', screenshot: null };
    this.openDialog('record');
  }

  // Checks the chosen image before it is sent. The server checks it again.
  protected onFileChosen(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.errors.update((errors) => ({ ...errors, screenshot: '' }));
    this.record.screenshot = null;
    if (!file) {
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      this.errors.update((errors) => ({ ...errors, screenshot: 'Upload a PNG, JPG or WEBP image.' }));
    } else if (file.size > MAX_IMAGE_BYTES) {
      this.errors.update((errors) => ({ ...errors, screenshot: 'The image is too large. The limit is 2 MB.' }));
    } else {
      this.record.screenshot = file;
    }
  }

  protected recordPayment(): void {
    const invoice = this.openInvoice();
    if (!invoice || this.errors()['screenshot']) {
      return;
    }
    this.startWorking();
    this.paymentsApi.recordPayment(invoice.id, this.record).subscribe({
      next: () => this.finish(`Payment recorded. Invoice ${invoice.invoice_number} is paid.`),
      error: (error) => this.fail(error),
    });
  }

  protected openVoid(): void {
    this.reason = '';
    this.openDialog('void');
  }

  protected voidInvoice(): void {
    const invoice = this.openInvoice();
    if (!invoice) {
      return;
    }
    this.startWorking();
    this.paymentsApi.voidInvoice(invoice.id, this.reason).subscribe({
      next: () => this.finish(`Invoice ${invoice.invoice_number} was voided.`),
      error: (error) => this.fail(error),
    });
  }

  // ---------- Payment pop-up ----------
  protected showPayment(payment: Payment): void {
    this.openPayment.set(payment);
    this.clearScreenshot();
    this.openDialog('payment');

    if (payment.has_screenshot) {
      this.paymentsApi.screenshot(payment.id).subscribe({
        next: (blob) => this.screenshotUrl.set(URL.createObjectURL(blob)),
        error: () => this.dialogError.set('The screenshot could not be loaded.'),
      });
    }
  }

  protected confirmPayment(): void {
    const payment = this.openPayment();
    if (!payment) {
      return;
    }
    this.startWorking();
    this.paymentsApi.confirm(payment.id).subscribe({
      next: () => this.finish(`Payment confirmed. Invoice ${payment.invoice_number} is paid.`),
      error: (error) => this.fail(error),
    });
  }

  protected openReject(): void {
    this.reason = '';
    this.openDialog('reject');
  }

  protected rejectPayment(): void {
    const payment = this.openPayment();
    if (!payment) {
      return;
    }
    this.startWorking();
    this.paymentsApi.reject(payment.id, this.reason).subscribe({
      next: () => this.finish('Payment rejected.'),
      error: (error) => this.fail(error),
    });
  }

  protected close(): void {
    this.dialog.set('none');
    this.clearScreenshot();
  }

  // Back from "Record payment" or "Void" to the invoice, and from "Reject" to the payment.
  protected back(dialog: Dialog): void {
    this.openDialog(dialog);
  }

  // ---------- Small shared steps ----------
  private openDialog(dialog: Dialog): void {
    this.dialogError.set('');
    this.errors.set({});
    this.working.set(false);
    this.dialog.set(dialog);
  }

  private startWorking(): void {
    this.dialogError.set('');
    this.errors.set({});
    this.working.set(true);
  }

  private finish(message: string): void {
    this.working.set(false);
    this.close();
    this.toast.success(message);
    this.reload();
  }

  private fail(error: unknown): void {
    this.working.set(false);
    this.errors.set(fieldErrors(error));
    this.dialogError.set(errorMessage(error));
  }

  private clearScreenshot(): void {
    if (this.screenshotUrl()) {
      URL.revokeObjectURL(this.screenshotUrl());
      this.screenshotUrl.set('');
    }
  }
}
