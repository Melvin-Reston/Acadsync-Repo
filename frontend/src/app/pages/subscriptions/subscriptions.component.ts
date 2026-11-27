import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  SUBSCRIPTION_STATUSES,
  errorMessage,
  fieldErrors,
  peso,
  planPrice,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from '../../core/helpers';
import { FieldErrors, Plan, Subscription, SubscriptionStatus, Teacher } from '../../core/models';
import { PlansService } from '../../core/plans.service';
import { SubscriptionFilters, SubscriptionsService } from '../../core/subscriptions.service';
import { TeachersService } from '../../core/teachers.service';
import { ToastService } from '../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { PaginationComponent } from '../../shared/pagination.component';

const EMPTY_COUNTS: Record<SubscriptionStatus, number> = {
  trial: 0,
  active: 0,
  past_due: 0,
  expired: 0,
  cancelled: 0,
};

@Component({
  selector: 'app-subscriptions',
  imports: [FormsModule, RouterLink, DatePipe, DropdownComponent, IconComponent, ModalComponent, PaginationComponent],
  templateUrl: './subscriptions.component.html',
})
export class SubscriptionsComponent implements OnInit {
  private readonly subscriptionsApi = inject(SubscriptionsService);
  private readonly plansApi = inject(PlansService);
  private readonly teachersApi = inject(TeachersService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // Optional values from the address bar, e.g. /subscriptions?status=past_due or ?plan_id=2
  // ?add=5 opens the Add subscription pop-up for teacher 5.
  readonly status = input('');
  readonly plan_id = input('');
  readonly add = input('');

  protected filters: SubscriptionFilters = { search: '', plan_id: null, status: '', page: 1, page_size: 10 };

  // "All plans" is the '' option; the handler maps it back to null.
  protected readonly planFilterOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'All plans' },
    ...this.plans().map((plan) => ({ value: plan.id, label: plan.name })),
  ]);

  protected readonly statusFilterOptions: DropdownOption[] = [
    { value: '', label: 'All statuses' },
    { value: 'current', label: 'Current (trial, active, past due)' },
    { value: 'trial', label: 'Trial' },
    { value: 'active', label: 'Active' },
    { value: 'past_due', label: 'Past due' },
    { value: 'expired', label: 'Expired' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  // Add-form plans: Teacher Free is only ever a first plan, so once the
  // chosen teacher has had any subscription it is not offered. The
  // backend refuses it too.
  protected readonly planOptions = computed<DropdownOption[]>(() => {
    const hadSubscription = !!this.chosenTeacher()?.subscription_status;
    return this.plans()
      .filter((plan) => plan.is_active && (!hadSubscription || Number(plan.price) !== 0))
      .map((plan) => ({ value: plan.id, label: `${plan.name} · ${planPrice(plan)}` }));
  });

  protected readonly subscriptions = signal<Subscription[]>([]);
  protected readonly total = signal(0);
  protected readonly counts = signal(EMPTY_COUNTS);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  // Add subscription pop-up
  protected readonly showForm = signal(false);
  protected readonly dialogError = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly saving = signal(false);
  protected readonly teacherResults = signal<Teacher[]>([]);
  protected readonly chosenTeacher = signal<Teacher | null>(null);
  protected teacherSearch = '';
  protected planId: number | null = null;
  protected withTrial = true;

  protected readonly peso = peso;
  protected readonly statuses = SUBSCRIPTION_STATUSES;
  protected readonly planPrice = planPrice;
  protected readonly statusLabel = subscriptionStatusLabel;
  protected readonly statusTone = subscriptionStatusTone;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private teacherTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    if (this.status()) this.filters.status = this.status();
    if (this.plan_id()) this.filters.plan_id = Number(this.plan_id());

    this.plansApi.list().subscribe({ next: (response) => this.plans.set(response.items) });
    this.load();

    if (this.add()) {
      this.openForm();
      const teacherId = Number(this.add());
      if (teacherId > 0) {
        this.teachersApi.get(teacherId).subscribe({
          next: (response) => this.chosenTeacher.set(response.teacher),
          error: () => undefined,
        });
      }
    }
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');

    this.subscriptionsApi.list(this.filters).subscribe({
      next: (page) => {
        this.subscriptions.set(page.items);
        this.total.set(page.total);
        this.counts.set(page.counts);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.loading.set(false);
      },
    });
  }

  protected onSearch(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.applyFilters(), 300);
  }

  protected applyFilters(): void {
    this.filters.page = 1;
    this.load();
  }

  protected filterByStatus(status: string): void {
    this.filters.status = this.filters.status === status ? '' : status;
    this.applyFilters();
  }

  protected goToPage(page: number): void {
    this.filters.page = page;
    this.load();
  }

  protected get hasFilters(): boolean {
    return Boolean(this.filters.search || this.filters.plan_id || this.filters.status);
  }

  protected get activePlans(): Plan[] {
    return this.plans().filter((plan) => plan.is_active);
  }

  protected get chosenPlan(): Plan | null {
    return this.plans().find((plan) => plan.id === this.planId) ?? null;
  }

  // ---------- Add subscription ----------
  protected openForm(): void {
    this.dialogError.set('');
    this.errors.set({});
    this.saving.set(false);
    this.chosenTeacher.set(null);
    this.teacherResults.set([]);
    this.teacherSearch = '';
    this.planId = null;
    this.withTrial = true;
    this.showForm.set(true);
  }

  protected onTeacherSearch(): void {
    clearTimeout(this.teacherTimer);
    this.teacherTimer = setTimeout(() => {
      if (!this.teacherSearch.trim()) {
        this.teacherResults.set([]);
        return;
      }
      this.teachersApi
        .list({ search: this.teacherSearch, school_id: null, status: '', page: 1, page_size: 8 })
        .subscribe({ next: (page) => this.teacherResults.set(page.items) });
    }, 300);
  }

  protected chooseTeacher(teacher: Teacher | null): void {
    this.chosenTeacher.set(teacher);
    this.teacherResults.set([]);
    this.teacherSearch = '';
  }

  protected hasCurrent(teacher: Teacher): boolean {
    return ['trial', 'active', 'past_due'].includes(teacher.subscription_status ?? '');
  }

  protected saveSubscription(): void {
    const teacher = this.chosenTeacher();
    if (!teacher || !this.planId) {
      this.dialogError.set('Choose a teacher and a plan.');
      return;
    }

    this.dialogError.set('');
    this.errors.set({});
    this.saving.set(true);
    this.subscriptionsApi.create(teacher.id, this.planId, this.withTrial).subscribe({
      next: (response) => {
        this.saving.set(false);
        this.showForm.set(false);
        this.toast.success(`${response.subscription.plan_name} was added for ${teacher.first_name} ${teacher.last_name}.`);
        this.router.navigate(['/subscriptions', response.subscription.id]);
      },
      error: (error) => {
        this.saving.set(false);
        this.errors.set(fieldErrors(error));
        this.dialogError.set(errorMessage(error));
      },
    });
  }
}
