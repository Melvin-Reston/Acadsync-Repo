// Teacher Dashboard: subscription, adviser assignment, announcements, and the
// teacher's classes today (Batch 2). Grades and attendance arrive in later batches.
import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
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
import { FieldErrors, Plan, TeacherDashboard, TeacherHoliday } from '../../../core/models';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import { TeacherAuthService } from '../../../core/teacher-auth.service';
import { ToastService } from '../../../core/toast.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
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
  protected readonly year = inject(ViewingYearService);

  protected readonly data = signal<TeacherDashboard | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  // The academic year a load is already in flight for: the viewing-year
  // effect can fire twice for the same year on first render, and loading
  // the dashboard twice is wasted work. The guard clears when the load
  // settles.
  private loadingYear: string | null = null;
  protected readonly saving = signal(false);
  protected readonly formErrors = signal<FieldErrors>({});

  // Adviser form
  protected isAdviser = false;
  protected advisoryGrade: number | null = null;
  protected advisorySection = '';

  // School details for the DepEd print forms (Region, Division, School ID).
  // The teacher's own entries on the teachers record (migration 010); the
  // same fields the Profile page edits, so both forms stay in step.
  protected region = '';
  protected division = '';
  protected depedSchoolId = '';

  // School calendar for SF2 (Batch 8 fix 10): the first and last day of
  // classes on the teachers record (migration 013), and the teacher's
  // holidays. Empty dates mean unset, and SF2 then counts every weekday.
  protected classesStartDate = '';
  protected classesEndDate = '';
  protected readonly holidays = signal<TeacherHoliday[]>([]);
  protected readonly holidayErrors = signal<FieldErrors>({});
  protected readonly holidaySaving = signal(false);
  protected newHolidayDate = '';
  protected newHolidayName = '';

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
    // Reload the counts, today's classes and consolidation card whenever
    // the year in the top bar changes.
    effect(() => {
      const viewing = this.year.selectedYear();
      if (viewing) this.load(viewing);
      else if (this.year.loaded()) this.load();
    });
  }

  protected load(academicYear?: string): void {
    const yearKey = academicYear ?? this.year.selectedYear() ?? '';
    if (yearKey === this.loadingYear) return;
    this.loadingYear = yearKey;
    this.loading.set(true);
    this.portal.dashboard(academicYear ?? this.year.selectedYear() ?? undefined).subscribe({
      next: (dashboard) => {
        this.loadingYear = null;
        this.loading.set(false);
        this.data.set(dashboard);
        const teacher = dashboard.teacher;
        this.isAdviser = teacher.is_adviser;
        this.advisoryGrade = teacher.advisory_grade;
        this.advisorySection = teacher.advisory_section ?? '';
        this.region = teacher.region ?? '';
        this.division = teacher.division ?? '';
        this.depedSchoolId = teacher.deped_school_id ?? '';
        this.classesStartDate = teacher.classes_start_date ?? '';
        this.classesEndDate = teacher.classes_end_date ?? '';
        this.holidays.set(dashboard.holidays ?? []);
      },
      error: (error) => {
        this.loadingYear = null;
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

    this.error.set('');
    this.saving.set(true);
    this.portal
      .updateAdviser({
        is_adviser: this.isAdviser,
        advisory_grade: this.isAdviser ? this.advisoryGrade : null,
        advisory_section: this.isAdviser ? this.advisorySection.trim() : null,
      })
      .subscribe({
        next: (response) => {
          this.applyTeacher(response.teacher);
          // The school details and calendar dates ride on the same Save
          // button: they are the teacher's own fields on the same record,
          // saved through the profile endpoint, which only changes the
          // fields sent.
          this.portal
            .updateSchoolDetails({
              region: this.region.trim(),
              division: this.division.trim(),
              deped_school_id: this.depedSchoolId.trim(),
              classes_start_date: this.classesStartDate,
              classes_end_date: this.classesEndDate,
            })
            .subscribe({
              next: (details) => {
                this.saving.set(false);
                this.applyTeacher(details.teacher);
                this.toast.success('Assignment saved.');
              },
              error: (error) => {
                // The assignment itself is already saved above; only the
                // school details and calendar dates failed, so keep the
                // typed values in the form for a retry instead of clearing
                // them.
                this.saving.set(false);
                this.formErrors.set(fieldErrors(error));
                this.error.set(errorMessage(error));
              },
            });
        },
        error: (error) => {
          this.saving.set(false);
          this.formErrors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  private applyTeacher(teacher: TeacherDashboard['teacher']): void {
    const current = this.data();
    if (current) {
      this.data.set({ ...current, teacher: { ...current.teacher, ...teacher } });
    }
    // Keep the layout's teacher card in step with the filed assignment.
    this.auth.setTeacher(teacher);
  }

  // A YYYY-MM-DD date as "Jun 15, 2026", or an em dash when unset.
  // Parsed from the text itself, never through Date, so the timezone
  // cannot move it a day.
  protected calendarDateLabel(value: string | null): string {
    if (!value) return '—';
    const [year, month, day] = value.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[month - 1]} ${day}, ${year}`;
  }

  // Holidays save the moment they are added or removed — they are a list,
  // not part of the Save assignment form.
  protected addHoliday(): void {
    const errors: FieldErrors = {};
    if (!this.newHolidayDate) errors['date'] = 'Choose a date.';
    if (!this.newHolidayName.trim()) errors['name'] = 'Type the holiday name.';
    this.holidayErrors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.error.set('');
    this.holidaySaving.set(true);
    this.portal
      .addHoliday({ date: this.newHolidayDate, name: this.newHolidayName.trim() })
      .subscribe({
        next: (response) => {
          this.holidaySaving.set(false);
          this.holidays.set(
            [...this.holidays(), response.holiday].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
          );
          this.newHolidayDate = '';
          this.newHolidayName = '';
          this.toast.success('Holiday added.');
        },
        error: (error) => {
          this.holidaySaving.set(false);
          this.holidayErrors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  protected removeHoliday(holiday: TeacherHoliday): void {
    this.error.set('');
    this.holidaySaving.set(true);
    this.portal.deleteHoliday(holiday.id).subscribe({
      next: () => {
        this.holidaySaving.set(false);
        this.holidays.set(this.holidays().filter((item) => item.id !== holiday.id));
        this.toast.success('Holiday removed.');
      },
      error: (error) => {
        this.holidaySaving.set(false);
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
