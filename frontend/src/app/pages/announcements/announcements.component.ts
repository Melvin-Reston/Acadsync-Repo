import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnnouncementFilters, AnnouncementsService } from '../../core/announcements.service';
import { audienceLabel, errorMessage, fieldErrors, todayIso } from '../../core/helpers';
import { Announcement, AnnouncementForm, FieldErrors } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown.component';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { PaginationComponent } from '../../shared/pagination.component';

type Dialog = 'none' | 'form' | 'delete';

const EMPTY_FORM: AnnouncementForm = { title: '', body: '', audience: 'all', starts_on: '', ends_on: '' };

const AUDIENCE_OPTIONS: DropdownOption[] = [
  { value: 'all', label: 'All teachers' },
  { value: 'free', label: 'Free only' },
  { value: 'pro', label: 'Pro only' },
];

@Component({
  selector: 'app-announcements',
  imports: [FormsModule, DatePipe, DropdownComponent, IconComponent, ModalComponent, PaginationComponent],
  templateUrl: './announcements.component.html',
})
export class AnnouncementsComponent {
  private readonly announcementsApi = inject(AnnouncementsService);
  private readonly toast = inject(ToastService);

  protected filters: AnnouncementFilters = { search: '', status: '', audience: '', page: 1, page_size: 10 };

  protected readonly audienceFilterOptions: DropdownOption[] = [
    { value: '', label: 'All audiences' },
    ...AUDIENCE_OPTIONS,
  ];

  protected readonly statusOptions: DropdownOption[] = [
    { value: '', label: 'All statuses' },
    { value: 'live', label: 'Showing' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'ended', label: 'Ended' },
  ];

  protected readonly audienceOptions: DropdownOption[] = AUDIENCE_OPTIONS;

  protected readonly announcements = signal<Announcement[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly dialog = signal<Dialog>('none');
  protected readonly dialogError = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly saving = signal(false);
  protected readonly selected = signal<Announcement | null>(null);

  protected form: AnnouncementForm = { ...EMPTY_FORM };
  protected readonly today = todayIso();

  protected readonly audienceLabel = audienceLabel;

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');

    this.announcementsApi.list(this.filters).subscribe({
      next: (page) => {
        this.announcements.set(page.items);
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
    return Boolean(this.filters.search || this.filters.status || this.filters.audience);
  }

  protected statusLabel(status: Announcement['status']): string {
    return { live: 'Showing', scheduled: 'Scheduled', ended: 'Ended' }[status];
  }

  protected statusTone(status: Announcement['status']): string {
    return { live: 'accent', scheduled: 'amber', ended: 'plain' }[status];
  }

  // ---------- Add / edit ----------
  protected openForm(announcement: Announcement | null): void {
    this.selected.set(announcement);
    this.form = announcement
      ? {
          title: announcement.title,
          body: announcement.body,
          audience: announcement.audience,
          starts_on: announcement.starts_on ?? '',
          ends_on: announcement.ends_on,
        }
      : { ...EMPTY_FORM };
    this.openDialog('form');
  }

  protected saveAnnouncement(): void {
    this.startSaving();
    const announcement = this.selected();
    const request = announcement
      ? this.announcementsApi.update(announcement.id, this.form)
      : this.announcementsApi.create(this.form);

    request.subscribe({
      next: () => this.finishSaving(`Announcement ${announcement ? 'updated' : 'created'}.`),
      error: (error) => this.failSaving(error),
    });
  }

  // ---------- Delete ----------
  protected openDelete(announcement: Announcement): void {
    this.selected.set(announcement);
    this.openDialog('delete');
  }

  protected deleteAnnouncement(): void {
    const announcement = this.selected();
    if (!announcement) {
      return;
    }
    this.startSaving();
    this.announcementsApi.remove(announcement.id).subscribe({
      next: () => this.finishSaving('Announcement deleted.'),
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
