import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { actionLabel, actionTone, errorMessage, roleLabel } from '../../core/helpers';
import { ActivityEntry, ActivityPage } from '../../core/models';
import { ActivityFilters, SystemService } from '../../core/system.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { PaginationComponent } from '../../shared/pagination.component';

@Component({
  selector: 'app-activity',
  imports: [FormsModule, DatePipe, DropdownComponent, IconComponent, PaginationComponent],
  templateUrl: './activity.component.html',
})
export class ActivityComponent {
  private readonly system = inject(SystemService);

  protected filters: ActivityFilters = {
    search: '',
    action: '',
    admin_id: null,
    from: '',
    to: '',
    page: 1,
    page_size: 20,
  };

  // The "Type" dropdown. The value is the first part of the action name, e.g. teacher.create.
  protected readonly types = [
    { value: 'auth', label: 'Sign-in' },
    { value: 'teacher', label: 'Teachers' },
    { value: 'school', label: 'Schools' },
    { value: 'plan', label: 'Plans' },
    { value: 'subscription', label: 'Subscriptions' },
    { value: 'invoice', label: 'Invoices' },
    { value: 'payment', label: 'Payments' },
    { value: 'announcement', label: 'Announcements' },
    { value: 'admin', label: 'Admin account' },
    { value: 'password', label: 'Passwords' },
    { value: 'profile', label: 'Profile' },
    { value: 'settings', label: 'Settings' },
  ];

  protected readonly typeOptions: DropdownOption[] = [
    { value: '', label: 'All types' },
    ...this.types.map((type) => ({ value: type.value, label: type.label })),
  ];

  // "All accounts" is the '' option; the handler maps it back to null.
  protected readonly adminOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'All accounts' },
    ...this.admins().map((admin) => ({
      value: admin.id,
      label: `${admin.full_name} (${roleLabel(admin.role)})`,
    })),
  ]);

  protected readonly entries = signal<ActivityEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly admins = signal<ActivityPage['admins']>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly actionLabel = actionLabel;
  protected readonly actionTone = actionTone;
  protected readonly roleLabel = roleLabel;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');

    this.system.activity(this.filters).subscribe({
      next: (page) => {
        this.entries.set(page.items);
        this.total.set(page.total);
        this.admins.set(page.admins);
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

  protected goToPage(page: number): void {
    this.filters.page = page;
    this.load();
  }

  protected get hasFilters(): boolean {
    const f = this.filters;
    return Boolean(f.search || f.action || f.admin_id || f.from || f.to);
  }

  protected clearFilters(): void {
    this.filters = { ...this.filters, search: '', action: '', admin_id: null, from: '', to: '' };
    this.applyFilters();
  }
}
