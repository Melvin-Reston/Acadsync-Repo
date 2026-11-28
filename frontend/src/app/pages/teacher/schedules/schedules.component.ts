// Schedules: the teacher's own weekly timetable, daily agenda, faculty matrix and
// room occupancy — all from the teacher's real meetings. Other teachers are never shown.
// A meeting can be added for one day, or repeated for the whole week (Monday–Friday);
// a day that would conflict is skipped and reported, never blocking the rest.
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { errorMessage, fieldErrors, manilaNow, time12 } from '../../../core/helpers';
import { ClassItem, FieldErrors, Meeting, ScheduleMeeting, ScheduleResponse } from '../../../core/models';
import { ClassesService, MeetingCreateResult, MeetingForm } from '../../../core/classes.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { MenuComponent, MenuItem } from '../../../shared/menu.component';
import { ModalComponent } from '../../../shared/modal.component';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const back = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - back);
  return d;
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseIso(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

@Component({
  selector: 'app-teacher-schedules',
  imports: [FormsModule, IconComponent, DropdownComponent, MenuComponent, ModalComponent],
  templateUrl: './schedules.component.html',
  styleUrl: './schedules.component.css',
})
export class TeacherSchedulesComponent {
  private readonly classesService = inject(ClassesService);
  protected readonly year = inject(ViewingYearService);
  private readonly toast = inject(ToastService);

  protected readonly schedule = signal<ScheduleResponse | null>(null);
  protected readonly classes = signal<ClassItem[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  // The academic year a load is already in flight for: the viewing-year
  // effect can fire twice for the same year on first render, and loading
  // the timetable and the class list twice is wasted work. The guard
  // clears when the load settles, so Refresh and later saves still reload.
  private loadingYear: string | null = null;
  protected readonly saving = signal(false);
  protected readonly formErrors = signal<FieldErrors>({});
  protected readonly refreshedAt = signal<Date | null>(null);

  protected readonly weekStart = signal(iso(mondayOf(new Date())));
  protected readonly tab = signal<'grid' | 'agenda' | 'faculty' | 'rooms'>('grid');
  protected readonly classFilter = signal<number | ''>('');
  protected readonly agendaDay = signal<string>(manilaNow().date);

  // Manage Class Schedules
  protected readonly manageOpen = signal(false);
  protected editingMeeting: Meeting | null = null;
  protected formClassId: number | null = null;
  protected formDay = 1;
  protected formStart = '07:30';
  protected formEnd = '08:30';
  protected formRoom = '';
  // Whole-week add: one meeting per weekday at the same time and room.
  protected repeatWeek = false;
  // The result of the last whole-week add, shown in the modal until the
  // next save: which days were created and which were skipped, and why.
  protected readonly weekResult = signal<{
    created: string[];
    skipped: { day_name: string; reason: string }[];
  } | null>(null);
  // The result of the last whole-week edit, shown in the modal until it
  // closes: which days were changed and which were skipped, and why.
  protected readonly seriesResult = signal<{
    updated: string[];
    skipped: { day_name: string; reason: string }[];
  } | null>(null);
  protected readonly deleteMeetingTarget = signal<{ meeting: Meeting; wholeWeek: boolean } | null>(null);
  // Whole-week edit: the new time and room apply to every day of the
  // series, not just the day that was opened. Set when the edit opens
  // from "Edit whole week"; the checkbox in the form can turn it off.
  protected applyToWeek = false;

  // The days of the series the meeting being edited belongs to: every
  // weekday this class already meets at the same time and room. Set when
  // the edit opens; empty when the meeting stands alone.
  protected readonly seriesDays = signal<string[]>([]);

  // The 3-dots actions on a meeting: Edit / Delete for that one day, and,
  // when the meeting is part of a Monday–Friday series at the same time
  // and room, Edit whole week / Delete whole week for the whole line.
  protected meetingMenuItemsFor(meeting: ScheduleMeeting): MenuItem[] {
    const series = this.seriesDaysFor(meeting);
    const items: MenuItem[] = [{ value: 'edit', label: 'Edit' }];
    if (series.length >= 2) {
      items.push({ value: 'edit-week', label: `Edit whole week (${series.join(', ')})` });
    }
    items.push({ value: 'delete', label: 'Delete', danger: true });
    if (series.length >= 2) {
      items.push({ value: 'delete-week', label: 'Delete whole week', danger: true });
    }
    return items;
  }

  private seriesDaysFor(meeting: ScheduleMeeting): string[] {
    const start = meeting.start_time.slice(0, 5);
    const end = meeting.end_time.slice(0, 5);
    return (this.schedule()?.meetings ?? [])
      .filter(
        (other) =>
          other.class_id === meeting.class_id &&
          other.start_time.slice(0, 5) === start &&
          other.end_time.slice(0, 5) === end &&
          other.room === meeting.room,
      )
      .map((other) => other.day_name)
      .filter((day, index, list) => list.indexOf(day) === index)
      .sort((a, b) => DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b));
  }

  protected meetingMenuAction(action: string, meeting: ScheduleMeeting): void {
    if (action === 'edit') {
      this.openEditMeeting(meeting);
      return;
    }
    if (action === 'edit-week') {
      this.openEditMeeting(meeting, true);
      return;
    }
    if (action === 'delete') {
      this.deleteMeetingTarget.set({ meeting, wholeWeek: false });
      return;
    }
    if (action === 'delete-week') {
      this.deleteMeetingTarget.set({ meeting, wholeWeek: true });
    }
  }

  protected readonly time12 = time12;
  protected readonly dayNames = DAY_NAMES;

  protected readonly classOptions = computed<DropdownOption[]>(() =>
    this.classes().map((klass) => ({
      value: klass.id,
      label: `${klass.subject_name} · ${klass.section_name} (Grade ${klass.grade_level})`,
      sub: klass.room,
      initials: klass.subject_name.slice(0, 2).toUpperCase(),
    })),
  );

  protected readonly dayOptions: DropdownOption[] = DAY_NAMES.map((name, index) => ({
    value: index + 1,
    label: name,
  }));

  protected readonly weekLabel = computed(() => {
    const days = this.schedule()?.days;
    if (!days || days.length === 0) return '';
    const first = parseIso(days[0].date);
    const last = parseIso(days[days.length - 1].date);
    const fmt = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    return `${fmt(first)} – ${fmt(last)}, ${last.getFullYear()}`;
  });

  protected readonly filteredMeetings = computed(() => {
    const meetings = this.schedule()?.meetings ?? [];
    if (this.classFilter() === '') return meetings;
    return meetings.filter((meeting) => meeting.class_id === this.classFilter());
  });

  protected readonly unscheduledClasses = computed(() =>
    this.classes().filter((klass) => klass.meeting_count === 0),
  );

  protected readonly gridHours = computed(() => {
    const meetings = this.filteredMeetings();
    if (meetings.length === 0) return [7, 8, 9, 10, 11, 12, 13, 14, 15];
    const starts = meetings.map((m) => Number(m.start_time.split(':')[0]));
    const ends = meetings.map((m) => Number(m.end_time.split(':')[0]));
    const first = Math.max(6, Math.min(...starts));
    const last = Math.min(18, Math.max(...ends));
    const hours: number[] = [];
    for (let hour = first; hour <= last; hour++) hours.push(hour);
    return hours;
  });

  protected readonly agendaMeetings = computed(() => {
    const day = this.agendaDay();
    return this.filteredMeetings()
      .filter((meeting) => meeting.date === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  });

  protected readonly agendaLabel = computed(() => {
    const day = this.schedule()?.days.find((d) => d.date === this.agendaDay());
    if (!day) return '';
    return `${day.day_name}, ${parseIso(day.date).toLocaleDateString('en-PH', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })}`;
  });

  protected readonly rooms = computed(() => {
    const rooms = new Set(this.filteredMeetings().map((meeting) => meeting.room));
    return [...rooms].sort();
  });

  protected readonly filteredClasses = computed(() => {
    if (this.classFilter() === '') return this.classes();
    return this.classes().filter((klass) => klass.id === this.classFilter());
  });

  // The timetable lookups, built once per load instead of re-scanning the
  // whole meeting list from the template for every grid, matrix and room
  // cell on every change-detection run. The template reads them by key.
  protected readonly dayLabels = computed(() => {
    const labels = new Map<string, string>();
    for (const day of this.schedule()?.days ?? []) {
      labels.set(day.date, parseIso(day.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }));
    }
    return labels;
  });

  protected readonly gridMeetings = computed(() => {
    const byKey = new Map<string, ScheduleMeeting[]>();
    for (const meeting of this.filteredMeetings()) {
      const key = `${meeting.date}|${Number(meeting.start_time.split(':')[0])}`;
      const list = byKey.get(key);
      if (list) list.push(meeting);
      else byKey.set(key, [meeting]);
    }
    return byKey;
  });

  protected readonly classDayMeetings = computed(() => {
    const byKey = new Map<string, ScheduleMeeting[]>();
    for (const meeting of this.filteredMeetings()) {
      const key = `${meeting.class_id}|${meeting.date}`;
      const list = byKey.get(key);
      if (list) list.push(meeting);
      else byKey.set(key, [meeting]);
    }
    return byKey;
  });

  protected readonly roomDayMeetings = computed(() => {
    const byKey = new Map<string, ScheduleMeeting[]>();
    for (const meeting of this.filteredMeetings()) {
      const key = `${meeting.room}|${meeting.date}`;
      const list = byKey.get(key);
      if (list) list.push(meeting);
      else byKey.set(key, [meeting]);
    }
    return byKey;
  });

  // Now/Next for the agenda, worked out once per render from one Manila
  // "now" instead of rebuilding the Manila clock for every meeting, twice,
  // on every change-detection run.
  protected readonly agendaStatusById = computed(() => {
    const statuses = new Map<number, 'now' | 'next' | null>();
    const now = manilaNow();
    for (const meeting of this.agendaMeetings()) {
      if (this.agendaDay() !== now.date) {
        statuses.set(meeting.id, null);
        continue;
      }
      if (meeting.start_time.slice(0, 5) <= now.time && meeting.end_time.slice(0, 5) > now.time) {
        statuses.set(meeting.id, 'now');
      } else if (meeting.start_time.slice(0, 5) > now.time) {
        statuses.set(meeting.id, 'next');
      } else {
        statuses.set(meeting.id, null);
      }
    }
    return statuses;
  });

  protected readonly refreshedLabel = computed(() => {
    const refreshed = this.refreshedAt();
    if (!refreshed) return '';
    return refreshed.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  });

  constructor() {
    effect(() => {
      if (this.year.selectedYear() || this.year.loaded()) this.load();
    });
  }

  protected load(): void {
    const yearKey = this.year.selectedYear() ?? '';
    if (yearKey === this.loadingYear) return;
    this.loadingYear = yearKey;
    this.loading.set(true);
    this.classesService.schedule(this.weekStart(), this.year.selectedYear() ?? undefined).subscribe({
      next: (response) => {
        this.loadingYear = null;
        this.schedule.set(response);
        this.loading.set(false);
        // The agenda opens on today when today is in this week, otherwise Monday.
        const today = manilaNow().date;
        this.agendaDay.set(response.days.some((d) => d.date === today) ? today : response.week_start);
      },
      error: (error) => {
        this.loadingYear = null;
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
    this.classesService.classes({ academic_year: this.year.selectedYear() ?? '' }).subscribe({
      next: (response) => this.classes.set(response.items),
      error: () => undefined,
    });
  }

  protected refresh(): void {
    this.load();
    this.refreshedAt.set(new Date());
    this.toast.success('Schedules refreshed.');
  }

  protected prevWeek(): void {
    const d = parseIso(this.weekStart());
    d.setDate(d.getDate() - 7);
    this.weekStart.set(iso(d));
    this.load();
  }

  protected nextWeek(): void {
    const d = parseIso(this.weekStart());
    d.setDate(d.getDate() + 7);
    this.weekStart.set(iso(d));
    this.load();
  }

  protected goToday(): void {
    this.weekStart.set(iso(mondayOf(new Date())));
    this.load();
  }

  protected exportCsv(): void {
    this.classesService.exportScheduleCsv(this.weekStart(), this.year.selectedYear() ?? undefined);
  }

  protected meetingsAt(day: string, hour: number): ScheduleMeeting[] {
    return this.gridMeetings().get(`${day}|${hour}`) ?? [];
  }

  protected meetingsForClassDay(classId: number, date: string): ScheduleMeeting[] {
    return this.classDayMeetings().get(`${classId}|${date}`) ?? [];
  }

  protected meetingsForRoomDay(room: string, date: string): ScheduleMeeting[] {
    return this.roomDayMeetings().get(`${room}|${date}`) ?? [];
  }

  protected agendaStatus(meeting: Meeting): 'now' | 'next' | null {
    return this.agendaStatusById().get(meeting.id) ?? null;
  }

  protected dayLabel(date: string): string {
    return this.dayLabels().get(date) ?? '';
  }

  // ---------- Manage Class Schedules ----------

  protected openManage(prefillClassId?: number): void {
    this.editingMeeting = null;
    this.formClassId = prefillClassId ?? this.classes()[0]?.id ?? null;
    this.formDay = 1;
    this.formStart = '07:30';
    this.formEnd = '08:30';
    this.formRoom = this.classes().find((klass) => klass.id === this.formClassId)?.room ?? '';
    this.repeatWeek = false;
    this.applyToWeek = false;
    this.seriesDays.set([]);
    this.weekResult.set(null);
    this.seriesResult.set(null);
    this.formErrors.set({});
    this.manageOpen.set(true);
  }

  protected openEditMeeting(meeting: Meeting, wholeWeek = false): void {
    this.editingMeeting = meeting;
    this.formClassId = meeting.class_id;
    this.formDay = meeting.day_of_week;
    this.formStart = meeting.start_time.slice(0, 5);
    this.formEnd = meeting.end_time.slice(0, 5);
    this.formRoom = meeting.room;
    this.repeatWeek = false;
    this.applyToWeek = wholeWeek;
    this.seriesDays.set(this.seriesDaysFor(meeting as ScheduleMeeting));
    this.weekResult.set(null);
    this.seriesResult.set(null);
    this.formErrors.set({});
    this.manageOpen.set(true);
  }

  protected onClassChange(): void {
    if (this.editingMeeting) return;
    this.formRoom = this.classes().find((klass) => klass.id === this.formClassId)?.room ?? '';
  }

  protected saveMeeting(): void {
    if (!this.formClassId) return;
    const wholeWeek = this.repeatWeek && !this.editingMeeting;
    const applyToWeek = this.applyToWeek && !!this.editingMeeting;
    const form: MeetingForm = {
      class_id: this.formClassId,
      day_of_week: this.formDay,
      start_time: this.formStart,
      end_time: this.formEnd,
      room: this.formRoom.trim(),
      repeat_week: wholeWeek,
      apply_to_week: applyToWeek,
    };
    this.saving.set(true);
    this.weekResult.set(null);
    this.seriesResult.set(null);
    // One Observable type for both paths, so subscribe infers one result type.
    const request: Observable<MeetingCreateResult> = this.editingMeeting
      ? this.classesService.updateMeeting(this.editingMeeting.id, form)
      : this.classesService.createMeeting(form);
    request.subscribe({
      next: (result) => {
        this.saving.set(false);
        const wasEdit = !!this.editingMeeting;
        if (wholeWeek && 'meetings' in result) {
          // Whole-week add: report plainly which days were created and
          // which were skipped, and why.
          this.weekResult.set({
            created: (result.meetings ?? []).map((meeting: Meeting) => meeting.day_name),
            skipped: (result.skipped ?? []).map((skip: { day_name: string; reason: string }) => ({
              day_name: skip.day_name,
              reason: skip.reason,
            })),
          });
          this.toast.success(result.message ?? 'Meetings added for the week.');
        } else if (applyToWeek && 'updated' in result && result.updated) {
          // Whole-week edit: report which days changed and which were
          // skipped. A skipped day keeps the modal open on the same
          // edit so the reason stays visible; otherwise the modal
          // closes like any other edit.
          this.seriesResult.set({
            updated: result.updated ?? [],
            skipped: (result.skipped ?? []).map((skip) => ({ day_name: skip.day_name, reason: skip.reason })),
          });
          this.toast.success(result.message ?? 'Meeting changed for the whole week.');
          this.load();
          if ((result.skipped ?? []).length > 0) return;
          this.editingMeeting = null;
          this.manageOpen.set(false);
          return;
        } else {
          this.toast.success(wasEdit ? 'Meeting updated.' : 'Meeting added.');
        }
        this.editingMeeting = null;
        this.load();
        if (wasEdit) this.manageOpen.set(false);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.formErrors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
      },
    });
  }

  protected confirmDeleteMeeting(): void {
    const target = this.deleteMeetingTarget();
    if (!target) return;
    this.classesService.deleteMeeting(target.meeting.id, target.wholeWeek).subscribe({
      next: (result) => {
        this.deleteMeetingTarget.set(null);
        this.toast.success(
          target.wholeWeek ? `${result.deleted} meetings deleted.` : 'Meeting deleted.',
        );
        this.load();
      },
      error: (error) => {
        this.deleteMeetingTarget.set(null);
        this.error.set(errorMessage(error));
      },
    });
  }
}
