// Teacher Dashboard: subscription, adviser assignment, announcements, and the
// teacher's classes today (Batch 2). Grades and attendance arrive in later batches.
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  errorMessage,
  fieldErrors,
  peso,
  planPrice,
  subscriptionStatusLabel,
  subscriptionStatusTone,
  time12,
} from '../../../core/helpers';
import { FieldErrors, Plan, TeacherDashboard } from '../../../core/models';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import { TeacherAuthService } from '../../../core/teacher-auth.service';
import { ToastService } from '../../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';

@Component({
  selector: 'app-teacher-dashboard',
  imports: [FormsModule, DatePipe, RouterLink, IconComponent, DropdownComponent],
  templateUrl: './teacher-dashboard.component.html',
  styleUrl: './teacher-dashboard.component.css',
})
export class TeacherDashboardComponent {
  private readonly portal = inject(TeacherPortalService);
  private readonly auth = inject(TeacherAuthService);
  private readonly toast = inject(ToastService);

  protected readonly data = signal<TeacherDashboard | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  protected readonly formErrors = signal<FieldErrors>({});

  // Adviser form
  protected isAdviser = false;
  protected advisoryGrade: number | null = null;
  protected advisorySection = '';

  protected readonly advisoryGradeOptions: DropdownOption[] = [7, 8, 9, 10, 11, 12].map((grade) => ({
    value: grade,
    label: `Grade ${grade}`,
  }));

  // Choose a plan (shown when the teacher has no current plan)
  protected readonly planPickerOpen = signal(false);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly selectedPlanId = signal<number | null>(null);
  protected readonly choosingPlan = signal(false);

  protected readonly today = new Date();
  protected readonly peso = peso;
  protected readonly planPrice = planPrice;
  protected readonly time12 = time12;
  protected readonly subscriptionStatusLabel = subscriptionStatusLabel;
  protected readonly subscriptionStatusTone = subscriptionStatusTone;

  protected readonly teacher = computed(() => this.data()?.teacher ?? null);
  protected readonly subscription = computed(() => this.data()?.subscription ?? null);
  protected readonly announcements = computed(() => this.data()?.announcements ?? []);
  protected readonly todayClasses = computed(() => this.data()?.today_classes ?? []);
  protected readonly consolidation = computed(() => this.data()?.consolidation ?? null);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.portal.dashboard().subscribe({
      next: (dashboard) => {
        this.loading.set(false);
        this.data.set(dashboard);
        const teacher = dashboard.teacher;
        this.isAdviser = teacher.is_adviser;
        this.advisoryGrade = teacher.advisory_grade;
        this.advisorySection = teacher.advisory_section ?? '';
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  // What happens next with the teacher's plan.
  protected nextStep(): string {
    const subscription = this.subscription();
    const invoice = this.data()?.next_invoice;
    if (!subscription) return 'No plan yet. Choose one below to get started.';
    if (subscription.status === 'trial' && subscription.trial_ends_at) {
      return `Trial ends ${this.date(subscription.trial_ends_at)}. Then ${peso(subscription.price)} is due.`;
    }
    if (subscription.status === 'past_due' && invoice) {
      return `Invoice ${invoice.invoice_number} for ${peso(invoice.amount)} is unpaid, due ${this.date(invoice.due_date)}.`;
    }
    if (subscription.status === 'active') {
      return subscription.billing_cycle === 'one_time'
        ? `Ends ${this.date(subscription.current_period_end)}.`
        : `Renews ${this.date(subscription.current_period_end)}.`;
    }
    if (subscription.status === 'expired') {
      return 'Your plan has ended. Choose a plan below to start a new one.';
    }
    return `Ended ${this.date(subscription.current_period_end)}.`;
  }

  protected saveAdviser(): void {
    const errors: FieldErrors = {};
    if (this.isAdviser && (!this.advisoryGrade || !this.advisorySection.trim())) {
      errors['advisory_section'] = 'Choose an advisory grade and type the advisory section.';
    }
    this.formErrors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.saving.set(true);
    this.portal
      .updateAdviser({
        is_adviser: this.isAdviser,
        advisory_grade: this.isAdviser ? this.advisoryGrade : null,
        advisory_section: this.isAdviser ? this.advisorySection.trim() : null,
      })
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          const current = this.data();
          if (current) {
            this.data.set({ ...current, teacher: { ...current.teacher, ...response.teacher } });
          }
          // Keep the layout's teacher card in step with the filed assignment.
          this.auth.setTeacher(response.teacher);
          this.toast.success('Assignment saved.');
        },
        error: (error) => {
          this.saving.set(false);
          this.formErrors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  protected openPlanPicker(): void {
    this.planPickerOpen.set(true);
    if (this.plans().length > 0) return;
    this.portal.activePlans().subscribe({
      next: (response) => this.plans.set(response.items),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected choosePlan(): void {
    const planId = this.selectedPlanId();
    if (!planId) return;
    this.choosingPlan.set(true);
    this.portal.choosePlan(planId).subscribe({
      next: () => {
        this.choosingPlan.set(false);
        this.planPickerOpen.set(false);
        this.toast.success('Plan chosen.');
        this.load();
      },
      error: (error) => {
        this.choosingPlan.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  private date(value: string): string {
    return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
