import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage, fieldErrors, planPrice } from '../../core/helpers';
import { BillingCycle, FieldErrors, Plan } from '../../core/models';
import { PlansService } from '../../core/plans.service';
import { ToastService } from '../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';

type Dialog = 'none' | 'form' | 'delete';

// The form keeps the features as text, one per line.
interface PlanFormValues {
  name: string;
  price: string;
  billing_cycle: BillingCycle;
  duration_months: number;
  trial_days: number;
  features: string;
  is_popular: boolean;
  sort_order: number;
}

const EMPTY_FORM: PlanFormValues = {
  name: '',
  price: '',
  billing_cycle: 'monthly',
  duration_months: 1,
  trial_days: 0,
  features: '',
  is_popular: false,
  sort_order: 0,
};

@Component({
  selector: 'app-plans',
  imports: [FormsModule, RouterLink, DropdownComponent, IconComponent, ModalComponent],
  templateUrl: './plans.component.html',
})
export class PlansComponent {
  private readonly plansApi = inject(PlansService);
  private readonly toast = inject(ToastService);

  protected readonly plans = signal<Plan[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly dialog = signal<Dialog>('none');
  protected readonly dialogError = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly saving = signal(false);
  protected readonly selected = signal<Plan | null>(null);

  protected form: PlanFormValues = { ...EMPTY_FORM };

  protected readonly billingCycleOptions: DropdownOption[] = [
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' },
    { value: 'one_time', label: 'One time' },
  ];

  protected readonly planPrice = planPrice;

  constructor() {
    this.load();
  }

  protected load(): void {
    this.plansApi.list().subscribe({
      next: (response) => {
        this.plans.set(response.items);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.loading.set(false);
      },
    });
  }

  protected get isFree(): boolean {
    return Number(this.form.price || 0) === 0;
  }

  protected trialLabel(plan: Plan): string {
    if (plan.trial_days === 0) {
      return 'None';
    }
    return plan.trial_days === 30 ? '1 month' : `${plan.trial_days} days`;
  }

  // ---------- Add / edit ----------
  protected openForm(plan: Plan | null): void {
    this.selected.set(plan);
    this.form = plan
      ? {
          name: plan.name,
          price: plan.price,
          billing_cycle: plan.billing_cycle,
          duration_months: plan.duration_months,
          trial_days: plan.trial_days,
          features: plan.features.join('\n'),
          is_popular: plan.is_popular,
          sort_order: plan.sort_order,
        }
      : { ...EMPTY_FORM };
    this.openDialog('form');
  }

  protected savePlan(): void {
    this.startSaving();
    const plan = this.selected();
    const values = {
      ...this.form,
      price: String(this.form.price ?? '').trim(),
      features: this.form.features
        .split('\n')
        .map((feature) => feature.trim())
        .filter(Boolean),
    };
    const request = plan ? this.plansApi.update(plan.id, values) : this.plansApi.create(values);

    request.subscribe({
      next: (response) => this.finishSaving(`${response.plan.name} was ${plan ? 'updated' : 'added'}.`),
      error: (error) => this.failSaving(error),
    });
  }

  // ---------- Activate / deactivate / delete ----------
  protected setActive(plan: Plan, active: boolean): void {
    this.plansApi.setActive(plan.id, active).subscribe({
      next: () => {
        this.toast.success(`${plan.name} was ${active ? 'activated' : 'deactivated'}.`);
        this.load();
      },
      error: (error) => this.toast.error(errorMessage(error)),
    });
  }

  protected openDelete(plan: Plan): void {
    this.selected.set(plan);
    this.openDialog('delete');
  }

  protected deletePlan(): void {
    const plan = this.selected();
    if (!plan) {
      return;
    }
    this.startSaving();
    this.plansApi.remove(plan.id).subscribe({
      next: () => this.finishSaving(`${plan.name} was deleted.`),
      error: (error) => this.failSaving(error),
    });
  }

  protected close(): void {
    this.dialog.set('none');
  }

  // ---------- Small shared steps ----------
  private openDialog(dialog: Dialog): void {
    this.dialogError.set('');
    this.errors.set({});
    this.saving.set(false);
    this.dialog.set(dialog);
  }

  private startSaving(): void {
    this.dialogError.set('');
    this.errors.set({});
    this.saving.set(true);
  }

  private finishSaving(message: string): void {
    this.saving.set(false);
    this.close();
    this.toast.success(message);
    this.load();
  }

  private failSaving(error: unknown): void {
    this.saving.set(false);
    this.errors.set(fieldErrors(error));
    this.dialogError.set(errorMessage(error));
  }
}
