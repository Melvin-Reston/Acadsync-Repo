// Schedules: the teacher's own weekly timetable, daily agenda, faculty matrix and
// room occupancy — all from the teacher's real meetings. Other teachers are never shown.
// A meeting can be added for one day, or repeated for the whole week (Monday–Friday);
// a day that would conflict is skipped and reported, never blocking the rest.
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { errorMessage, fieldErrors, manilaNow, time12 } from '../../../core/helpers';
import { ClassItem, FieldErrors, Meeting, ScheduleMeeting, ScheduleResponse } from '../../../core/models';
import { ClassesService, MeetingCreateResult, MeetingForm } from '../../../core/classes.service';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
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
  imports: [FormsModule, IconComponent, DropdownComponent, ModalComponent],
  templateUrl: './schedules.component.html',
  styleUrl: './schedules.component.css',
})
export class TeacherSchedulesComponent {
  private readonly classesService = inject(ClassesService);
  private readonly portal = inject(TeacherPortalService);
  private readonly toast = inject(ToastService);

  protected readonly schedule = signal<ScheduleResponse | null>(null);
  protected readonly classes = signal<ClassItem[]>([]);
  protected readonly academicYear = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
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
  protected readonly deleteMeetingTarget = signal<Meeting | null>(null);

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

  constructor() {
    this.portal.me().subscribe({
      next: (response) => this.academicYear.set(response.academic_year),
      error: () => undefined,
    });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.classesService.schedule(this.weekStart()).subscribe({
      next: (response) => {
        this.schedule.set(response);
        this.loading.set(false);
        // The agenda opens on today when today is in this week, otherwise Monday.
        const today = manilaNow().date;
        this.agendaDay.set(response.days.some((d) => d.date === today) ? today : response.week_start);
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
    this.classesService.classes({}).subscribe({
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
    this.classesService.exportScheduleCsv(this.weekStart());
  }

  protected meetingsAt(day: string, hour: number): ScheduleMeeting[] {
    return this.filteredMeetings().filter(
      (meeting) => meeting.date === day && Number(meeting.start_time.split(':')[0]) === hour,
    );
  }

  protected meetingsForClassDay(classId: number, date: string): ScheduleMeeting[] {
    return this.filteredMeetings().filter(
      (meeting) => meeting.class_id === classId && meeting.date === date,
    );
  }

  protected meetingsForRoomDay(room: string, date: string): ScheduleMeeting[] {
    return this.filteredMeetings().filter(
      (meeting) => meeting.room === room && meeting.date === date,
    );
  }

  protected agendaStatus(meeting: Meeting): 'now' | 'next' | null {
    if (this.agendaDay() !== manilaNow().date) return null;
    const time = manilaNow().time;
    if (meeting.start_time.slice(0, 5) <= time && meeting.end_time.slice(0, 5) > time) return 'now';
    if (meeting.start_time.slice(0, 5) > time) return 'next';
    return null;
  }

  protected dayLabel(date: string): string {
    return parseIso(date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
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
    this.weekResult.set(null);
    this.formErrors.set({});
    this.manageOpen.set(true);
  }

  protected openEditMeeting(meeting: Meeting): void {
    this.editingMeeting = meeting;
    this.formClassId = meeting.class_id;
    this.formDay = meeting.day_of_week;
    this.formStart = meeting.start_time.slice(0, 5);
    this.formEnd = meeting.end_time.slice(0, 5);
    this.formRoom = meeting.room;
    this.repeatWeek = false;
    this.weekResult.set(null);
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
    const form: MeetingForm = {
      class_id: this.formClassId,
      day_of_week: this.formDay,
      start_time: this.formStart,
      end_time: this.formEnd,
      room: this.formRoom.trim(),
      repeat_week: wholeWeek,
    };
    this.saving.set(true);
    this.weekResult.set(null);
    // One Observable type for both paths, so subscribe infers one result type.
    const request: Observable<{ meeting: Meeting } | MeetingCreateResult> = this.editingMeeting
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
    const meeting = this.deleteMeetingTarget();
    if (!meeting) return;
    this.classesService.deleteMeeting(meeting.id).subscribe({
      next: () => {
        this.deleteMeetingTarget.set(null);
        this.toast.success('Meeting deleted.');
        this.load();
      },
      error: (error) => {
        this.deleteMeetingTarget.set(null);
        this.error.set(errorMessage(error));
      },
    });
  }
}
