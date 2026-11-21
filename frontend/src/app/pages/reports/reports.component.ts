import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  billingCycleLabel,
  downloadBlob,
  SUBSCRIPTION_STATUSES,
  errorMessage,
  peso,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from '../../core/helpers';
import { IncomeReport, SubscriptionsReport, TeachersPerSchoolReport } from '../../core/models';
import { ReportName, ReportsService } from '../../core/reports.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-reports',
  imports: [FormsModule, DatePipe, IconComponent],
  templateUrl: './reports.component.html',
})
export class ReportsComponent {
  private readonly reportsApi = inject(ReportsService);
  private readonly toast = inject(ToastService);

  protected readonly tabs: { name: ReportName; label: string }[] = [
    { name: 'income', label: 'Income' },
    { name: 'subscriptions', label: 'Subscriptions' },
    { name: 'teachers-per-school', label: 'Teachers per school' },
  ];

  protected readonly report = signal<ReportName>('income');
  protected readonly loading = signal(true);
  protected readonly exporting = signal(false);
  protected readonly error = signal('');

  // Empty dates mean "this month so far". The API sends back the dates it used.
  protected from = '';
  protected to = '';

  protected readonly income = signal<IncomeReport | null>(null);
  protected readonly subscriptions = signal<SubscriptionsReport | null>(null);
  protected readonly schools = signal<TeachersPerSchoolReport | null>(null);

  protected readonly peso = peso;
  protected readonly statuses = SUBSCRIPTION_STATUSES;
  protected readonly billingCycleLabel = billingCycleLabel;
  protected readonly statusLabel = subscriptionStatusLabel;
  protected readonly statusTone = subscriptionStatusTone;

  constructor() {
    this.load();
  }

  protected show(report: ReportName): void {
    this.report.set(report);
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');

    const done = (range: { from: string; to: string }) => {
      this.from = range.from;
      this.to = range.to;
      this.loading.set(false);
    };
    const failed = (error: unknown) => {
      this.error.set(errorMessage(error));
      this.loading.set(false);
    };

    if (this.report() === 'income') {
      this.reportsApi.income(this.from, this.to).subscribe({
        next: (report) => {
          this.income.set(report);
          done(report);
        },
        error: failed,
      });
    } else if (this.report() === 'subscriptions') {
      this.reportsApi.subscriptions(this.from, this.to).subscribe({
        next: (report) => {
          this.subscriptions.set(report);
          done(report);
        },
        error: failed,
      });
    } else {
      this.reportsApi.teachersPerSchool(this.from, this.to).subscribe({
        next: (report) => {
          this.schools.set(report);
          done(report);
        },
        error: failed,
      });
    }
  }

  protected exportCsv(): void {
    const name = this.report();
    this.exporting.set(true);
    this.reportsApi.csv(name, this.from, this.to).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        downloadBlob(blob, `${name.replaceAll('-', '_')}_${this.from}_to_${this.to}.csv`);
      },
      error: () => {
        this.exporting.set(false);
        this.toast.error('The report could not be exported. Check the dates and try again.');
      },
    });
  }
}
