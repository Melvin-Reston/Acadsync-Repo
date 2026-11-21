// Attendance: the daily roll sheet for the teacher's own classes, with the
// modal-only QR check-in. The roll is the real enrolment list for the selected
// class and date; nothing is ever pre-filled. The Mark menu at the right end
// of each row stamps the time-in (Manila time) and the method; picking the
// same status again clears it.
// Saving persists the whole roll for that class and date in one go.
import {
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AttendanceService, RollMark } from '../../../core/attendance.service';
import { ClassesService } from '../../../core/classes.service';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import { ToastService } from '../../../core/toast.service';
import {
  errorMessage,
  initials,
  manilaNow,
  time12,
} from '../../../core/helpers';
import {
  AttendanceMark,
  AttendanceRoll,
  AttendanceRow,
  AttendanceStatus,
  ClassItem,
} from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { MenuComponent, MenuItem } from '../../../shared/menu.component';
import { ScanModalComponent } from './scan-modal.component';

const STATUSES: AttendanceStatus[] = ['present', 'late', 'absent', 'excused'];
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};
const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: 'P',
  late: 'L',
  absent: 'A',
  excused: 'E',
};

type Filter = 'all' | AttendanceStatus | 'none';

@Component({
  selector: 'app-teacher-attendance',
  imports: [FormsModule, RouterLink, IconComponent, DropdownComponent, MenuComponent, ScanModalComponent],
  templateUrl: './attendance.component.html',
  styleUrl: './attendance.component.css',
})
export class TeacherAttendanceComponent {
  private readonly attendance = inject(AttendanceService);
  private readonly classesService = inject(ClassesService);
  private readonly portal = inject(TeacherPortalService);
  private readonly toast = inject(ToastService);

  protected readonly classes = signal<ClassItem[]>([]);
  protected readonly academicYear = signal<string | null>(null);
  protected readonly roll = signal<AttendanceRoll | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly saving = signal(false);

  protected readonly selectedClassId = signal<number | ''>('');
  protected readonly date = signal(manilaNow().date);

  protected readonly classOptions = computed<DropdownOption[]>(() =>
    this.classes().map((klass) => ({
      value: klass.id,
      label: `${klass.subject_name} · ${klass.section_name}`,
      sub: `Grade ${klass.grade_level}`,
      initials: klass.subject_name.slice(0, 2).toUpperCase(),
    })),
  );

  // The Mark menu at the right end of each learner row.
  protected readonly markMenuItems: MenuItem[] = STATUSES.map((status) => ({
    value: status,
    label: STATUS_LABEL[status],
  }));
  protected readonly today = manilaNow().date;

  // The working roll: what the teacher has tapped, before saving.
  protected readonly marks = signal<Record<number, AttendanceMark>>({});
  // The last saved roll, for the dirty check and Discard changes.
  protected readonly savedMarks = signal<Record<number, AttendanceMark>>({});
  protected readonly savedAt = signal<string | null>(null);

  protected readonly filter = signal<Filter>('all');
  protected readonly search = signal('');

  protected readonly time12 = time12;
  protected readonly initials = initials;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusShort = STATUS_SHORT;

  // The QR check-in modal (its own component, with the camera).
  protected readonly scanOpen = signal(false);

  protected readonly counts = computed(() => {
    const learners = this.roll()?.learners ?? [];
    const marks = this.marks();
    const count = { enrolled: learners.length, present: 0, late: 0, absent: 0, excused: 0, none: 0, qr: 0, marked: 0 };
    for (const learner of learners) {
      const mark = marks[learner.id];
      if (!mark) {
        count.none++;
        continue;
      }
      count[mark.status]++;
      count.marked++;
      if (mark.method === 'qr') count.qr++;
    }
    return count;
  });

  protected readonly filteredLearners = computed(() => {
    const query = this.search().trim().toLowerCase();
    const filter = this.filter();
    const marks = this.marks();
    return (this.roll()?.learners ?? []).filter((learner) => {
      const mark = marks[learner.id];
      const status = mark ? mark.status : 'none';
      if (filter !== 'all' && status !== filter) return false;
      if (!query) return true;
      return `${learner.first_name} ${learner.last_name} ${learner.learner_id}`.toLowerCase().includes(query);
    });
  });

  protected readonly dirty = computed(
    () => JSON.stringify(this.marks()) !== JSON.stringify(this.savedMarks()),
  );

  protected readonly rollLabel = computed(() => {
    const count = this.counts();
    if (count.marked === 0) return 'marked — roll not taken yet';
    if (count.marked === count.enrolled) return 'marked — roll complete';
    return `marked — ${count.none} ${count.none === 1 ? 'learner' : 'learners'} still to mark`;
  });

  protected readonly rate = computed(() => {
    const count = this.counts();
    if (count.enrolled === 0) return '—';
    if (count.marked === 0) return '—';
    return `${Math.round(((count.present + count.late) / count.enrolled) * 100)}%`;
  });

  protected readonly selectedClass = computed(
    () => this.classes().find((klass) => klass.id === this.selectedClassId()) ?? null,
  );

  // The selected class id as a number (the template only shows the modal when one is chosen).
  protected readonly selectedClassIdNum = computed(() => {
    const id = this.selectedClassId();
    return typeof id === 'number' ? id : 0;
  });

  protected readonly dateLabel = computed(() => {
    const [year, month, day] = this.date().split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  });

  protected readonly footDate = computed(() => {
    const [year, month, day] = this.date().split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date
      .toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      .toUpperCase();
  });

  constructor() {
    this.portal.me().subscribe({
      next: (response) => this.academicYear.set(response.academic_year),
      error: () => undefined,
    });
    this.loadClasses();
  }

  // ---------- Loading ----------

  private loadClasses(): void {
    this.classesService.classes({}).subscribe({
      next: (response) => {
        this.classes.set(response.items);
        if (response.items.length === 0) {
          this.loading.set(false);
          return;
        }
        // Default to the teacher's first class that meets today, else the first class.
        this.portal.todayClasses().subscribe({
          next: (today) => {
            const firstToday = today.items.find((item) =>
              response.items.some((klass) => klass.id === item.class_id),
            );
            this.selectedClassId.set(firstToday?.class_id ?? response.items[0].id);
            this.loadRoll();
          },
          error: () => {
            this.selectedClassId.set(response.items[0].id);
            this.loadRoll();
          },
        });
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected loadRoll(): void {
    const classId = this.selectedClassId();
    if (classId === '') return;
    this.loading.set(true);
    this.attendance.roll(classId, this.date()).subscribe({
      next: (roll) => {
        this.roll.set(roll);
        const marks: Record<number, AttendanceMark> = {};
        for (const learner of roll.learners) {
          if (learner.mark) marks[learner.id] = { ...learner.mark };
        }
        this.marks.set(marks);
        this.savedMarks.set(JSON.parse(JSON.stringify(marks)));
        this.savedAt.set(roll.saved_at);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected onClassChange(): void {
    this.error.set('');
    this.loadRoll();
  }

  protected onDateChange(value: string): void {
    if (!value) return;
    this.date.set(value);
    this.error.set('');
    this.loadRoll();
  }

  // ---------- Marking ----------

  protected onMarkPicked(learner: AttendanceRow, value: string): void {
    this.setMark(learner, value as AttendanceStatus);
  }

  protected setMark(learner: AttendanceRow, status: AttendanceStatus): void {
    const current = this.marks()[learner.id];
    const next = { ...this.marks() };
    if (current && current.status === status) {
      // Tap again to clear.
      delete next[learner.id];
    } else if (status === 'absent' || status === 'excused') {
      next[learner.id] = { status, time_in: null, method: 'manual' };
    } else {
      next[learner.id] = { status, time_in: manilaNow().time, method: 'manual' };
    }
    this.marks.set(next);
  }

  protected markAllPresent(): void {
    const next = { ...this.marks() };
    const now = manilaNow().time;
    let changed = 0;
    for (const learner of this.roll()?.learners ?? []) {
      if (!next[learner.id]) {
        next[learner.id] = { status: 'present', time_in: now, method: 'manual' };
        changed++;
      }
    }
    this.marks.set(next);
    this.toast.success(
      changed > 0
        ? `Marked ${changed} ${changed === 1 ? 'learner' : 'learners'} present. Save to file the day sheet.`
        : 'Everyone is already marked.',
    );
  }

  protected discardChanges(): void {
    this.marks.set(JSON.parse(JSON.stringify(this.savedMarks())));
    this.toast.success('Changes discarded — back to the last saved roll.');
  }

  protected save(): void {
    const classId = this.selectedClassId();
    if (classId === '') return;
    const marks: RollMark[] = Object.entries(this.marks()).map(([learnerId, mark]) => ({
      learner_id: Number(learnerId),
      status: mark.status,
      method: mark.method,
      ...(mark.time_in ? { time_in: mark.time_in } : {}),
    }));
    this.saving.set(true);
    this.attendance.saveRoll(classId, this.date(), marks).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Attendance saved.');
        this.loadRoll();
      },
      error: (error) => {
        this.saving.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected exportCsv(): void {
    const klass = this.selectedClass();
    const classId = this.selectedClassId();
    if (!klass || classId === '') return;
    const safe = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    this.attendance.exportCsv(classId, this.date(), `attendance-${safe(klass.subject_name)}-${safe(klass.section_name)}-${this.date()}.csv`);
  }

  protected savedNote(): string {
    if (this.dirty()) {
      return this.savedAt() ? `Unsaved changes · last saved ${this.savedTime()}` : 'Unsaved changes';
    }
    return this.savedAt() ? `Saved ${this.savedTime()}` : 'Not saved yet';
  }

  private savedTime(): string {
    const savedAt = this.savedAt();
    if (!savedAt) return '';
    return new Date(savedAt).toLocaleTimeString('en-PH', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  protected resetFilter(): void {
    this.filter.set('all');
    this.search.set('');
  }

  protected pct(part: number, total: number): number {
    return total === 0 ? 0 : Math.round((part / total) * 100);
  }

  // ---------- QR scan modal ----------

  protected openScan(): void {
    this.scanOpen.set(true);
  }

  protected closeScan(): void {
    this.scanOpen.set(false);
    // The roll may have changed through a QR check-in.
    this.loadRoll();
  }

  // A QR check-in confirmed in the modal: show it in the working roll at once.
  protected onCheckedIn(event: { learnerId: number; mark: AttendanceMark }): void {
    const next = { ...this.marks() };
    next[event.learnerId] = { ...event.mark };
    this.marks.set(next);
  }
}
