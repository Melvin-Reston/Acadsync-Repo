import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage, fieldErrors } from '../../core/helpers';
import { FieldErrors, School, SchoolForm } from '../../core/models';
import { SchoolFilters, SchoolsService } from '../../core/schools.service';
import { ToastService } from '../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { PaginationComponent } from '../../shared/pagination.component';

type Dialog = 'none' | 'form' | 'merge';

const EMPTY_FORM: SchoolForm = {
  name: '',
  category: '',
  school_type: '',
  city_region: '',
  principal_contact: '',
};

@Component({
  selector: 'app-schools',
  imports: [FormsModule, RouterLink, DropdownComponent, IconComponent, ModalComponent, PaginationComponent],
  templateUrl: './schools.component.html',
})
export class SchoolsComponent {
  private readonly schoolsApi = inject(SchoolsService);
  private readonly toast = inject(ToastService);

  protected filters: SchoolFilters = { search: '', category: '', school_type: '', page: 1, page_size: 10 };

  protected readonly categoryFilterOptions: DropdownOption[] = [
    { value: '', label: 'All categories' },
    { value: 'Primary', label: 'Primary' },
    { value: 'Secondary', label: 'Secondary' },
  ];

  protected readonly schoolTypeFilterOptions: DropdownOption[] = [
    { value: '', label: 'All types' },
    { value: 'Public', label: 'Public' },
    { value: 'Private', label: 'Private' },
  ];

  protected readonly categoryOptions: DropdownOption[] = [
    { value: '', label: 'Choose' },
    { value: 'Primary', label: 'Primary' },
    { value: 'Secondary', label: 'Secondary' },
  ];

  protected readonly schoolTypeOptions: DropdownOption[] = [
    { value: '', label: 'Choose' },
    { value: 'Public', label: 'Public' },
    { value: 'Private', label: 'Private' },
  ];

  protected readonly schools = signal<School[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly dialog = signal<Dialog>('none');
  protected readonly dialogError = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly saving = signal(false);

  // Add / edit form
  protected readonly editing = signal<School | null>(null);
  protected form: SchoolForm = { ...EMPTY_FORM };

  // Merge form
  protected readonly allSchools = signal<School[]>([]);
  protected readonly keepId = signal<number | null>(null);
  protected readonly removeId = signal<number | null>(null);
  protected readonly keepSchool = computed(() => this.findSchool(this.keepId()));
  protected readonly removeSchool = computed(() => this.findSchool(this.removeId()));

  // The dropdown has no per-option disable, so each list leaves out the
  // school picked on the other side instead — the same school still cannot
  // be both kept and removed. "Choose a school" is the '' option; the
  // handler maps it back to null.
  protected readonly keepOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'Choose a school' },
    ...this.allSchools()
      .filter((school) => school.id !== this.removeId())
      .map((school) => ({
        value: school.id,
        label: `${school.name} · ${school.city_region} (${school.teacher_count})`,
      })),
  ]);

  protected readonly removeOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'Choose a school' },
    ...this.allSchools()
      .filter((school) => school.id !== this.keepId())
      .map((school) => ({
        value: school.id,
        label: `${school.name} · ${school.city_region} (${school.teacher_count})`,
      })),
  ]);

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');

    this.schoolsApi.list(this.filters).subscribe({
      next: (page) => {
        this.schools.set(page.items);
        this.total.set(page.total);
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
    return Boolean(this.filters.search || this.filters.category || this.filters.school_type);
  }

  // ---------- Add / edit ----------
  protected openForm(school: School | null): void {
    this.editing.set(school);
    this.form = school
      ? {
          name: school.name,
          category: school.category,
          school_type: school.school_type,
          city_region: school.city_region,
          principal_contact: school.principal_contact,
        }
      : { ...EMPTY_FORM };
    this.openDialog('form');
  }

  protected saveSchool(): void {
    this.startSaving();
    const school = this.editing();
    const request = school
      ? this.schoolsApi.update(school.id, this.form)
      : this.schoolsApi.create(this.form);

    request.subscribe({
      next: (response) => {
        this.finishSaving(`${response.school.name} was ${school ? 'updated' : 'added'}.`);
      },
      error: (error) => this.failSaving(error),
    });
  }

  // ---------- Merge ----------
  protected openMerge(): void {
    this.keepId.set(null);
    this.removeId.set(null);
    this.openDialog('merge');

    this.schoolsApi.options().subscribe({
      next: (response) => this.allSchools.set(response.items),
      error: (error) => this.dialogError.set(errorMessage(error)),
    });
  }

  protected mergeSchools(): void {
    const keep = this.keepSchool();
    const remove = this.removeSchool();
    if (!keep || !remove) {
      this.dialogError.set('Choose the school to keep and the school to remove.');
      return;
    }

    this.startSaving();
    this.schoolsApi.merge(keep.id, remove.id).subscribe({
      next: (response) => {
        this.finishSaving(
          `${remove.name} was merged into ${keep.name}. ${response.moved_teachers} teacher(s) moved.`,
        );
      },
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

  private findSchool(id: number | null): School | null {
    return this.allSchools().find((school) => school.id === id) ?? null;
  }
}
