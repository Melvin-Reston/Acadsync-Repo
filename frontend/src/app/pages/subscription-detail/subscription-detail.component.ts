import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import {
  billingCycleLabel,
  errorMessage,
  fieldErrors,
  invoiceStatusLabel,
  invoiceStatusTone,
  peso,
  planPrice,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from '../../core/helpers';
import { FieldErrors, Plan, Subscription, SubscriptionInvoice } from '../../core/models';
import { PlansService } from '../../core/plans.service';
import { SubscriptionsService } from '../../core/subscriptions.service';
import { ToastService } from '../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';

type Dialog = 'none' | 'extend' | 'cancel' | 'change';

@Component({
  selector: 'app-subscription-detail',
  imports: [FormsModule, RouterLink, DatePipe, DropdownComponent, IconComponent, ModalComponent],
  templateUrl: './subscription-detail.component.html',
})
export class SubscriptionDetailComponent implements OnInit {
  private readonly subscriptionsApi = inject(SubscriptionsService);
  private readonly plansApi = inject(PlansService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // From the address: /subscriptions/:id
  readonly id = input.required<string>();

  protected readonly subscription = signal<Subscription | null>(null);
  protected readonly invoices = signal<SubscriptionInvoice[]>([]);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly error = signal('');

  protected readonly dialog = signal<Dialog>('none');
  protected readonly dialogError = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly working = signal(false);

  protected months = 1;
  protected reason = '';
  protected planId: number | null = null;
  protected withTrial = false;

  protected readonly planOptions = computed<DropdownOption[]>(() => {
    const subscription = this.subscription();
    if (!subscription) return [];
    return this.otherPlans(subscription).map((plan) => ({
      value: plan.id,
      label: `${plan.name} · ${planPrice(plan)}`,
    }));
  });

  protected readonly peso = peso;
  protected readonly planPrice = planPrice;
  protected readonly billingCycleLabel = billingCycleLabel;
  protected readonly statusLabel = subscriptionStatusLabel;
  protected readonly statusTone = subscriptionStatusTone;
  protected readonly invoiceStatusLabel = invoiceStatusLabel;
  protected readonly invoiceStatusTone = invoiceStatusTone;

  ngOnInit(): void {
    this.load();
    this.plansApi.list().subscribe({ next: (response) => this.plans.set(response.items) });
  }

  private load(): void {
    this.subscriptionsApi.get(Number(this.id())).subscribe({
      next: (response) => {
        this.subscription.set(response.subscription);
        this.invoices.set(response.invoices);
      },
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected isCurrent(subscription: Subscription): boolean {
    return ['trial', 'active', 'past_due'].includes(subscription.status);
  }

  // Plans the teacher can move to: active ones, other than the plan they are on.
  // Teacher Free is never offered here: it can only ever be the teacher's
  // first plan, and changing plans means they have already had one.
  protected otherPlans(subscription: Subscription): Plan[] {
    return this.plans().filter((plan) => plan.is_active && plan.id !== subscription.plan_id && Number(plan.price) !== 0);
  }

  protected get chosenPlan(): Plan | null {
    return this.plans().find((plan) => plan.id === this.planId) ?? null;
  }

  protected open(dialog: Dialog): void {
    this.months = 1;
    this.reason = '';
    this.planId = null;
    this.withTrial = false;
    this.dialogError.set('');
    this.errors.set({});
    this.working.set(false);
    this.dialog.set(dialog);
  }

  protected close(): void {
    this.dialog.set('none');
  }

  protected extend(): void {
    this.run(this.subscriptionsApi.extend(Number(this.id()), this.months), 'Subscription extended.');
  }

  protected cancel(): void {
    this.run(this.subscriptionsApi.cancel(Number(this.id()), this.reason), 'Subscription cancelled.');
  }

  protected changePlan(): void {
    if (!this.planId) {
      this.dialogError.set('Choose a plan.');
      return;
    }
    this.working.set(true);
    this.dialogError.set('');
    this.subscriptionsApi.changePlan(Number(this.id()), this.planId, this.withTrial).subscribe({
      next: (response) => {
        this.working.set(false);
        this.close();
        this.toast.success(`Plan changed to ${response.subscription.plan_name}.`);
        // The change starts a new subscription, so show that one.
        this.router.navigate(['/subscriptions', response.subscription.id]).then(() => this.load());
      },
      error: (error) => this.fail(error),
    });
  }

  // Shared steps for extend / cancel.
  private run(request: Observable<{ subscription: Subscription }>, successText: string): void {
    this.working.set(true);
    this.dialogError.set('');
    this.errors.set({});

    request.subscribe({
      next: () => {
        this.working.set(false);
        this.close();
        this.toast.success(successText);
        this.load();
      },
      error: (error) => this.fail(error),
    });
  }

  private fail(error: unknown): void {
    this.working.set(false);
    this.errors.set(fieldErrors(error));
    this.dialogError.set(errorMessage(error));
  }
}
