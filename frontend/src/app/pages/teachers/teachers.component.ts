import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage, subscriptionStatusLabel } from '../../core/helpers';
import { School, Teacher } from '../../core/models';
import { SchoolsService } from '../../core/schools.service';
import { TeacherFilters, TeachersService } from '../../core/teachers.service';
import { ToastService } from '../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { PaginationComponent } from '../../shared/pagination.component';
import { TeacherFormComponent } from '../../shared/teacher-form.component';

@Component({
  selector: 'app-teachers',
  imports: [FormsModule, RouterLink, DatePipe, DropdownComponent, IconComponent, PaginationComponent, TeacherFormComponent],
  templateUrl: './teachers.component.html',
})
export class TeachersComponent implements OnInit {
  private readonly teachersApi = inject(TeachersService);
  private readonly schoolsApi = inject(SchoolsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // Optional values from the address bar, e.g. /teachers?school_id=3 or ?status=restricted or ?add=1
  readonly school_id = input('');
  readonly status = input('');
  readonly add = input('');

  protected filters: TeacherFilters = { search: '', school_id: null, status: '', page: 1, page_size: 10 };

  // "All schools" is the '' option; the handler maps it back to null.
  protected readonly schoolOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'All schools' },
    ...this.schools().map((school) => ({ value: school.id, label: school.name })),
  ]);

  protected readonly statusOptions: DropdownOption[] = [
    { value: '', label: 'All statuses' },
    { value: 'active', label: 'Active' },
    { value: 'restricted', label: 'Restricted' },
  ];

  protected readonly teachers = signal<Teacher[]>([]);
  protected readonly total = signal(0);
  protected readonly schools = signal<School[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly showForm = signal(false);

  protected readonly statusLabel = subscriptionStatusLabel;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnInit(): void {
    if (this.school_id()) this.filters.school_id = Number(this.school_id());
    if (this.status() === 'active' || this.status() === 'restricted') this.filters.status = this.status();
    if (this.add()) this.showForm.set(true);

    this.schoolsApi.options().subscribe({ next: (response) => this.schools.set(response.items) });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');

    this.teachersApi.list(this.filters).subscribe({
      next: (page) => {
        this.teachers.set(page.items);
        this.total.set(page.total);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.loading.set(false);
      },
    });
  }

  // Waits until typing stops before searching.
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
    return Boolean(this.filters.search || this.filters.school_id || this.filters.status);
  }

  protected onSaved(teacher: Teacher): void {
    this.showForm.set(false);
    this.toast.success(`${teacher.first_name} ${teacher.last_name} was added.`);
    this.router.navigate(['/teachers', teacher.id]);
  }
}
