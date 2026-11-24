// The attendance upload modal: a CSV grid of past records for one class, for
// a teacher who joined AcadSync after classes started. The file is one row
// per learner and one column per date — the shape of a paper record book —
// and may span several months at once. The template download gives one
// month's school days; the upload accepts any dates. Nothing is saved
// until the teacher sees the preview and confirms: unknown Learner IDs and
// unrecognised marks block the upload, name mismatches and weekend or
// future dates are warnings, and the server reports every mark it skips
// (already saved, not a school day, after today) without overwriting
// anything already marked.
import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AttendanceImportRecord,
  AttendanceImportResult,
  AttendanceService,
} from '../../../core/attendance.service';
import { ToastService } from '../../../core/toast.service';
import { downloadBlob, errorMessage, manilaNow } from '../../../core/helpers';
import { AttendanceRow, AttendanceStatus } from '../../../core/models';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';

const STATUS_FROM_CELL: Record<string, AttendanceStatus> = {
  P: 'present',
  PRESENT: 'present',
  L: 'late',
  LATE: 'late',
  A: 'absent',
  ABSENT: 'absent',
  X: 'absent',
  E: 'excused',
  EXCUSED: 'excused',
};

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};

const SKIP_REASON: Record<string, string> = {
  not_enrolled: 'Learner is not enrolled in this class.',
  duplicate_in_file: 'Listed twice in the file.',
  future_date: 'Date is after today.',
  not_a_school_day: 'Not a school day (weekend, holiday, or outside the first/last day of classes).',
  already_saved: 'That day already has a saved mark — left as it was.',
};

interface UploadPreview {
  records: AttendanceImportRecord[];
  errors: string[];
  warnings: string[];
  counts: Record<AttendanceStatus, number>;
  learners: number;
  dates: number;
  months: string[];
}

// The same small quoted-CSV reader the manual-grades upload uses: commas
// and newlines inside quotes stay inside the cell, and CRLF files read
// the same as LF files.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char === '\r') {
      // CRLF: the \n that follows ends the row.
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .sort();
}

@Component({
  selector: 'app-upload-modal',
  imports: [FormsModule, DropdownComponent, IconComponent, ModalComponent],
  templateUrl: './upload-modal.component.html',
  styleUrl: './upload-modal.component.css',
})
export class UploadModalComponent implements OnInit {
  private readonly attendance = inject(AttendanceService);
  private readonly toast = inject(ToastService);

  readonly classId = input.required<number>();
  readonly classLabel = input.required<string>();
  readonly monthOptions = input.required<DropdownOption[]>();
  readonly defaultMonth = input.required<string>();

  readonly imported = output<void>();
  readonly closed = output<void>();

  protected readonly templateMonth = signal('');
  protected readonly roster = signal<AttendanceRow[]>([]);
  protected readonly rosterError = signal('');
  protected readonly fileName = signal('');
  protected readonly preview = signal<UploadPreview | null>(null);
  protected readonly importing = signal(false);
  protected readonly importError = signal('');
  protected readonly result = signal<AttendanceImportResult | null>(null);
  protected readonly downloadingTemplate = signal(false);

  protected readonly skipReason = SKIP_REASON;

  ngOnInit(): void {
    this.templateMonth.set(this.defaultMonth() || String(this.monthOptions()[0]?.value ?? ''));
    // The roster is the class's roll for today: the learners, whatever
    // their marks. Preview matching runs against these rows only.
    this.attendance.roll(this.classId(), manilaNow().date).subscribe({
      next: (roll) => this.roster.set(roll.learners),
      error: (error) => this.rosterError.set(errorMessage(error)),
    });
  }

  protected close(): void {
    if (this.result()) this.imported.emit();
    this.closed.emit();
  }

  protected downloadTemplate(): void {
    const month = this.templateMonth();
    if (!month || this.downloadingTemplate()) return;
    this.downloadingTemplate.set(true);
    this.attendance.importTemplate(this.classId(), month).subscribe({
      next: (blob) => {
        this.downloadingTemplate.set(false);
        downloadBlob(blob, `attendance-template-${month}.csv`);
      },
      error: (error) => {
        this.downloadingTemplate.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.result.set(null);
    this.importError.set('');
    if (!file) {
      this.fileName.set('');
      this.preview.set(null);
      return;
    }
    this.fileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => this.preview.set(this.buildPreview(String(reader.result ?? '')));
    reader.onerror = () => {
      this.preview.set(null);
      this.importError.set('Could not read that file. Try choosing it again.');
    };
    reader.readAsText(file);
  }

  protected upload(): void {
    const preview = this.preview();
    if (!preview || preview.errors.length > 0 || this.importing()) return;
    this.importing.set(true);
    this.importError.set('');
    this.attendance.importRecords(this.classId(), preview.records).subscribe({
      next: (result) => {
        this.importing.set(false);
        this.result.set(result);
      },
      error: (error) => {
        this.importing.set(false);
        this.importError.set(errorMessage(error));
      },
    });
  }

  protected skippedName(skipped: { learner_id: number }): string {
    const learner = this.roster().find((row) => row.id === skipped.learner_id);
    return learner ? `${learner.last_name}, ${learner.first_name} (${learner.learner_id})` : `Learner ${skipped.learner_id}`;
  }

  private buildPreview(text: string): UploadPreview {
    const preview: UploadPreview = {
      records: [],
      errors: [],
      warnings: [],
      counts: { present: 0, late: 0, absent: 0, excused: 0 },
      learners: 0,
      dates: 0,
      months: [],
    };
    const rawRows = parseCsvRows(text.replace(/^\uFEFF/, '')).filter((row) =>
      row.some((cell) => cell.trim() !== '')
    );
    if (rawRows.length === 0) {
      preview.errors.push('The file is empty. Download the CSV template and fill it in.');
      return preview;
    }
    const header = rawRows[0].map((cell) => cell.trim());
    if (header.length < 3) {
      preview.errors.push('The header must have Learner ID, Student Name, and at least one date column (YYYY-MM-DD).');
      return preview;
    }
    if (header[0].toLowerCase() !== 'learner id' || header[1].toLowerCase() !== 'student name') {
      preview.errors.push('The first two columns must be Learner ID and Student Name, in that order.');
      return preview;
    }
    const dates: string[] = [];
    const seenDates = new Set<string>();
    for (const cell of header.slice(2)) {
      if (!isRealDate(cell)) {
        preview.errors.push(`'${cell}' is not a date. Date columns must be YYYY-MM-DD, for example 2026-06-15.`);
        continue;
      }
      if (seenDates.has(cell)) {
        preview.errors.push(`The date ${cell} appears twice. Keep one column per date.`);
        continue;
      }
      seenDates.add(cell);
      dates.push(cell);
    }
    if (preview.errors.length > 0) return preview;

    const today = manilaNow().date;
    for (const date of dates) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) {
        preview.warnings.push(`${date} is a weekend and will be skipped.`);
      }
      if (date > today) {
        preview.warnings.push(`${date} is after today and will be skipped.`);
      }
    }

    const rosterById = new Map(
      this.roster().map((learner) => [learner.learner_id.trim().toLowerCase(), learner])
    );
    const matched = new Set<number>();
    const dateSet = new Set<string>();
    const monthSet = new Set<string>();
    rawRows.slice(1).forEach((row, index) => {
      const rowNumber = index + 2;
      const learnerIdCell = (row[0] ?? '').trim();
      if (learnerIdCell === '') {
        preview.errors.push(`Row ${rowNumber} has no Learner ID.`);
        return;
      }
      const learner = rosterById.get(learnerIdCell.toLowerCase());
      if (!learner) {
        preview.errors.push(`Unknown Learner ID '${learnerIdCell}' on row ${rowNumber}. It is not enrolled in this class.`);
        return;
      }
      const nameCell = (row[1] ?? '').trim();
      if (nameCell !== '') {
        const fileTokens = nameTokens(nameCell).join(' ');
        const rosterTokens = nameTokens(`${learner.last_name}, ${learner.first_name}`).join(' ');
        if (fileTokens !== rosterTokens) {
          preview.warnings.push(
            `Row ${rowNumber}: the name '${nameCell}' does not match the roster name for ${learner.learner_id} — the marks still use the Learner ID.`
          );
        }
      }
      matched.add(learner.id);
      dates.forEach((date, dateIndex) => {
        const cell = (row[2 + dateIndex] ?? '').trim().toUpperCase();
        if (cell === '') return;
        const status = STATUS_FROM_CELL[cell];
        if (!status) {
          preview.errors.push(
            `Unrecognised mark '${cell}' for ${learner.learner_id} on ${date}. Use P, L, A or E (X also means Absent).`
          );
          return;
        }
        preview.records.push({ learner_id: learner.id, date, status });
        preview.counts[status] += 1;
        dateSet.add(date);
        monthSet.add(date.slice(0, 7));
      });
    });

    preview.learners = matched.size;
    preview.dates = dateSet.size;
    preview.months = [...monthSet].sort();
    if (preview.records.length === 0 && preview.errors.length === 0) {
      preview.errors.push('No marks found. Fill in P, L, A or E under the date columns.');
    }
    return preview;
  }
}
