// Academic Consolidation: the adviser's view of every subject grade for their
// advisory section. The grades are filed by each subject teacher from their
// Grades page; here the adviser reads them, sees which subjects are still
// waiting, and can remind a teacher. GWA is the mean of grades across
// submitted subjects only, and stays blank — with the reason named — until
// every subject is in. The final grades section shows each subject's final
// grade (the mean of its period grades) once every period is filed.
import {
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConsolidationService } from '../../../core/consolidation.service';
import { ToastService } from '../../../core/toast.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
import { errorMessage } from '../../../core/helpers';
import { ConsolidationFinals, ConsolidationView, ManualSubject } from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { ModalComponent } from '../../../shared/modal.component';

// ---- Manual subject CSV parsing (Batch 8 fix 10) ----
// The template header is "Learner ID,Student Name,Term 1,Term 2,Term 3"
// (or "Quarter 1..Quarter 4" for a DO 8 year). Rows are matched by Learner
// ID only; the name is a mismatch warning, never a rejection. Parsing
// tolerates a BOM, CRLF line endings, and quoted names with commas.
interface ManualCsvGrade {
  learner_id: string;
  quarter: number;
  grade: number;
}

interface ManualPreviewRow {
  line: number;
  learner_id: string;
  file_name: string;
  roster_name: string | null;
  name_mismatch: boolean;
  has_error: boolean;
  grades: (number | null)[];
  skipped: boolean;
}

interface ManualPreview {
  rows: ManualPreviewRow[];
  errors: string[];
  warnings: string[];
  grades: ManualCsvGrade[];
  skipped: number;
}

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

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .sort();
}

function parseManualCsv(
  text: string,
  periods: number[],
  roster: { learner_id: string; first_name: string; last_name: string }[],
): ManualPreview {
  const cleaned = text.replace(/^\uFEFF/, '');
  const rawRows = parseCsvRows(cleaned).filter((row) => row.some((cell) => cell.trim() !== ''));
  const preview: ManualPreview = { rows: [], errors: [], warnings: [], grades: [], skipped: 0 };
  if (rawRows.length === 0) {
    preview.errors.push('The file is empty. Download the CSV template and fill in the grades.');
    return preview;
  }
  const header = rawRows[0];
  if (header.length < 2 + periods.length) {
    preview.errors.push(
      `The header must have Learner ID, Student Name, and one column per period (${periods.length} columns of grades).`,
    );
    return preview;
  }
  const rosterById = new Map(
    roster.map((learner) => [
      learner.learner_id.trim().toLowerCase(),
      `${learner.last_name}, ${learner.first_name}`,
    ]),
  );
  const seen = new Set<string>();
  for (let i = 1; i < rawRows.length; i++) {
    const line = i + 1;
    const row = rawRows[i];
    const learnerId = (row[0] ?? '').trim();
    const fileName = (row[1] ?? '').trim();
    const grades: (number | null)[] = [];
    const rowErrors: string[] = [];
    for (let p = 0; p < periods.length; p++) {
      const cell = (row[2 + p] ?? '').trim();
      if (cell === '') {
        grades.push(null);
        continue;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(cell)) {
        rowErrors.push(`Line ${line}: "${cell}" is not a number.`);
        grades.push(null);
        continue;
      }
      const grade = Number(cell);
      if (grade < 0 || grade > 100) {
        rowErrors.push(`Line ${line}: ${grade} is outside 0–100.`);
        grades.push(null);
        continue;
      }
      grades.push(grade);
    }
    if (learnerId === '') {
      if (fileName === '' && grades.every((grade) => grade === null)) continue;
      preview.errors.push(`Line ${line}: Learner ID is missing.`);
      continue;
    }
    const key = learnerId.toLowerCase();
    let hasError = rowErrors.length > 0;
    if (seen.has(key)) {
      preview.errors.push(`Line ${line}: Learner ID "${learnerId}" appears more than once.`);
      hasError = true;
    }
    seen.add(key);
    const rosterName = rosterById.get(key) ?? null;
    if (rosterName === null) {
      preview.errors.push(`Line ${line}: Learner ID "${learnerId}" is not in this section.`);
      hasError = true;
    }
    preview.errors.push(...rowErrors);
    const skipped = grades.every((grade) => grade === null);
    let nameMismatch = false;
    if (rosterName !== null && fileName !== '') {
      nameMismatch = nameTokens(fileName).join(' ') !== nameTokens(rosterName).join(' ');
      if (nameMismatch) {
        preview.warnings.push(
          `Line ${line}: the name "${fileName}" does not match the roster name "${rosterName}" for ${learnerId}. The row is matched by Learner ID.`,
        );
      }
    }
    if (skipped) preview.skipped += 1;
    preview.rows.push({
      line,
      learner_id: learnerId,
      file_name: fileName,
      roster_name: rosterName,
      name_mismatch: nameMismatch,
      has_error: hasError,
      grades,
      skipped,
    });
    if (!hasError && !skipped) {
      grades.forEach((grade, p) => {
        if (grade !== null) {
          preview.grades.push({ learner_id: learnerId, quarter: periods[p], grade });
        }
      });
    }
  }
  return preview;
}

type Tab = 'all' | 'honors' | 'at_risk';

@Component({
  selector: 'app-teacher-consolidation',
  imports: [FormsModule, RouterLink, IconComponent, DropdownComponent, ModalComponent],
  templateUrl: './consolidation.component.html',
  styleUrl: './consolidation.component.css',
})
export class TeacherConsolidationComponent {
  private readonly consolidation = inject(ConsolidationService);
  protected readonly year = inject(ViewingYearService);
  private readonly toast = inject(ToastService);

  protected readonly view = signal<ConsolidationView | null>(null);
  protected readonly finals = signal<ConsolidationFinals | null>(null);
  protected readonly loading = signal(true);
  // The academic year a load is already in flight for: the viewing-year
  // effect can fire twice for the same year on first render, and loading
  // the view (plus finals and manual subjects) twice is wasted work. The
  // guard clears when the load settles, so quarter changes and later
  // saves still reload.
  private loadingYear: string | null = null;
  protected readonly error = signal('');
  protected readonly refreshing = signal(false);

  protected readonly quarter = signal(1);
  protected readonly search = signal('');
  protected readonly tab = signal<Tab>('all');
  protected readonly reminding = signal<number | null>(null);

  // Manual subjects (Batch 8 fix 10): created by the adviser when the
  // subject teacher has no AcadSync account, with grades uploaded as a CSV.
  protected readonly manualSubjects = signal<ManualSubject[]>([]);
  protected readonly createOpen = signal(false);
  protected readonly createName = signal('');
  protected readonly createTeacher = signal('');
  protected readonly createError = signal('');
  protected readonly creating = signal(false);
  protected readonly manageSubject = signal<ManualSubject | null>(null);
  protected readonly manageName = signal('');
  protected readonly manageTeacher = signal('');
  protected readonly manageError = signal('');
  protected readonly savingDetails = signal(false);
  protected readonly preview = signal<ManualPreview | null>(null);
  protected readonly previewFileName = signal('');
  protected readonly filing = signal(false);
  protected readonly deleting = signal(false);
  protected readonly confirmDelete = signal(false);

  // The periods the active grading system offers: Terms 1–3 under DO 015,
  // Quarters 1–4 under DO 8.
  protected readonly periods = computed(() => this.view()?.grading.periods ?? [1, 2, 3]);

  protected readonly periodOptions = computed<DropdownOption[]>(() =>
    this.periods().map((q) => ({
      value: q,
      label: `${this.view()?.grading.period_label ?? 'Quarter'} ${q}`,
    })),
  );

  protected readonly periodLabel = computed(() => {
    const view = this.view();
    return view ? `${view.grading.period_label} ${this.quarter()}` : '';
  });

  protected readonly filteredLearners = computed(() => {
    const view = this.view();
    if (!view) return [];
    const query = this.search().trim().toLowerCase();
    const tab = this.tab();
    return view.learners.filter((learner) => {
      if (tab === 'honors' && !learner.honors) return false;
      if (tab === 'at_risk' && !learner.at_risk) return false;
      if (!query) return true;
      return `${learner.first_name} ${learner.last_name} ${learner.learner_id}`
        .toLowerCase()
        .includes(query);
    });
  });

  protected readonly honorCount = computed(
    () => (this.view()?.learners ?? []).filter((learner) => learner.honors).length,
  );

  protected readonly atRiskCount = computed(
    () => (this.view()?.learners ?? []).filter((learner) => learner.at_risk).length,
  );

  protected readonly finalHonorCount = computed(
    () => (this.finals()?.learners ?? []).filter((learner) => learner.honors).length,
  );

  protected readonly finalAtRiskCount = computed(
    () => (this.finals()?.learners ?? []).filter((learner) => learner.at_risk).length,
  );

  protected readonly filteredFinalLearners = computed(() => {
    const finals = this.finals();
    if (!finals) return [];
    const query = this.search().trim().toLowerCase();
    const tab = this.tab();
    return finals.learners.filter((learner) => {
      if (tab === 'honors' && !learner.honors) return false;
      if (tab === 'at_risk' && !learner.at_risk) return false;
      if (!query) return true;
      return `${learner.first_name} ${learner.last_name} ${learner.learner_id}`
        .toLowerCase()
        .includes(query);
    });
  });

  constructor() {
    effect(() => {
      if (this.year.selectedYear() || this.year.loaded()) this.load();
    });
  }

  protected load(quarter?: number): void {
    const yearKey = this.year.selectedYear() ?? '';
    if (yearKey === this.loadingYear) return;
    this.loadingYear = yearKey;
    this.loading.set(true);
    // No period on the first load: the API opens the highest period that
    // already has data, else the first period, and the page follows it.
    this.consolidation.view(quarter, this.year.selectedYear() ?? undefined).subscribe({
      next: (view) => {
        this.loadingYear = null;
        this.view.set(view);
        this.quarter.set(view.quarter);
        this.loading.set(false);
        this.loadManualSubjects();
        this.loadFinals();
      },
      error: (error) => {
        this.loadingYear = null;
        this.loading.set(false);
        this.handleLoadError(error);
      },
    });
  }

  // The final grades across the year's periods. Loaded alongside the period
  // view; a teacher with no advisory assignment never gets here.
  private loadFinals(): void {
    this.consolidation.finals(this.year.selectedYear() ?? undefined).subscribe({
      next: (finals) => this.finals.set(finals),
      error: () => undefined,
    });
  }

  // A teacher with no advisory assignment gets the empty state, not an error:
  // the API refuses them with NO_ADVISORY, and the page tells them to set the
  // assignment on the Dashboard.
  private handleLoadError(error: unknown): void {
    if ((error as { error?: { code?: string } })?.error?.code === 'NO_ADVISORY') {
      this.view.set({
        has_advisory: false,
        academic_year: '',
        grading: {
          code: 'do015_adjusted',
          label: 'DO 015 · Adjusted',
          period_label: 'Term',
          period_short: 'T',
          periods: [1, 2, 3],
          grade_label: 'Term grade',
          third_label: 'Examinations',
          third_short: 'EX',
        },
        grade: null,
        section: null,
        quarter: this.quarter(),
        readiness: { submitted: 0, total: 0, pct: 0 },
        kpis: { class_gwa: null, subject_average: null, honor_count: 0, honor_pct: 0, at_risk_count: 0 },
        subjects: [],
        learners: [],
      });
      this.error.set('');
      return;
    }
    this.error.set(errorMessage(error));
  }

  protected onQuarterChange(value: number): void {
    this.quarter.set(value);
    this.error.set('');
    this.load(value);
  }

  protected refresh(): void {
    this.refreshing.set(true);
    this.consolidation.view(this.quarter(), this.year.selectedYear() ?? undefined).subscribe({
      next: (view) => {
        this.view.set(view);
        this.refreshing.set(false);
        this.toast.success('Consolidation refreshed.');
        this.loadManualSubjects();
        this.loadFinals();
      },
      error: (error) => {
        this.refreshing.set(false);
        this.handleLoadError(error);
      },
    });
  }

  protected remind(classId: number | null): void {
    if (classId === null) return;
    this.reminding.set(classId);
    this.consolidation.remind(classId, this.quarter()).subscribe({
      next: (response) => {
        this.reminding.set(null);
        this.toast.success(response.message);
        this.refresh();
      },
      error: (error) => {
        this.reminding.set(null);
        this.error.set(errorMessage(error));
      },
    });
  }

  // ---- Manual subjects (Batch 8 fix 10) ----

  private loadManualSubjects(): void {
    if (!this.view()?.has_advisory) {
      this.manualSubjects.set([]);
      return;
    }
    this.consolidation.listManualSubjects(this.year.selectedYear() ?? undefined).subscribe({
      next: (response) => this.manualSubjects.set(response.manual_subjects),
      error: () => this.manualSubjects.set([]),
    });
  }

  protected openCreate(): void {
    this.createName.set('');
    this.createTeacher.set('');
    this.createError.set('');
    this.createOpen.set(true);
  }

  protected createManual(): void {
    const subjectName = this.createName().trim();
    const teacherName = this.createTeacher().trim();
    if (!subjectName || !teacherName) {
      this.createError.set('Enter the subject name and the subject teacher\u2019s name.');
      return;
    }
    this.creating.set(true);
    this.createError.set('');
    this.consolidation.createManualSubject(subjectName, teacherName, this.year.selectedYear() ?? undefined).subscribe({
      next: () => {
        this.creating.set(false);
        this.createOpen.set(false);
        this.toast.success(`Manual subject "${subjectName}" added. Upload its grades from the subject card.`);
        this.load(this.quarter());
      },
      error: (error) => {
        this.creating.set(false);
        this.createError.set(errorMessage(error));
      },
    });
  }

  protected openManage(subject: { manual_subject_id: number | null }): void {
    const manual = this.manualSubjects().find((row) => row.id === subject.manual_subject_id) ?? null;
    if (!manual) return;
    this.manageSubject.set(manual);
    this.manageName.set(manual.subject_name);
    this.manageTeacher.set(manual.teacher_name);
    this.manageError.set('');
    this.preview.set(null);
    this.previewFileName.set('');
    this.confirmDelete.set(false);
  }

  protected closeManage(): void {
    this.manageSubject.set(null);
  }

  protected downloadTemplate(): void {
    const manual = this.manageSubject();
    if (!manual) return;
    const safe = manual.subject_name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    this.consolidation.downloadManualTemplate(manual.id, `manual-grades-${safe}.csv`);
  }

  protected onManualFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const view = this.view();
    if (!view || view.learners.length === 0) {
      this.manageError.set('Enrol learners in this section first before uploading grades.');
      this.preview.set(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.previewFileName.set(file.name);
      this.manageError.set('');
      this.preview.set(parseManualCsv(String(reader.result ?? ''), this.periods(), view.learners));
    };
    reader.onerror = () => {
      this.manageError.set('The file could not be read. Try choosing it again.');
    };
    reader.readAsText(file);
  }

  protected fileGrades(): void {
    const manual = this.manageSubject();
    const preview = this.preview();
    if (!manual || !preview || preview.errors.length > 0) return;
    if (preview.grades.length === 0) {
      this.manageError.set('The file has no grades to file. Fill in at least one grade, then choose the file again.');
      return;
    }
    this.filing.set(true);
    this.manageError.set('');
    this.consolidation.fileManualGrades(manual.id, preview.grades).subscribe({
      next: (response) => {
        this.filing.set(false);
        this.closeManage();
        this.toast.success(`${response.filed} grade${response.filed === 1 ? '' : 's'} filed for "${manual.subject_name}".`);
        this.load(this.quarter());
      },
      error: (error) => {
        this.filing.set(false);
        this.manageError.set(this.manualFileError(error));
      },
    });
  }

  // A rejected filing lists every invalid row, so the adviser can fix the
  // file and upload again. Nothing is saved when any row is invalid.
  private manualFileError(error: unknown): string {
    const body = (error as { error?: { message?: string; invalid_rows?: { learner_id: string; quarter: number; errors: string[] }[] } })?.error;
    const invalid = body?.invalid_rows ?? [];
    if (invalid.length === 0) return errorMessage(error);
    const lines = invalid.map((row) => `${row.learner_id} · ${this.periodLabelFor(row.quarter)}: ${row.errors.join(' ')}`);
    return `${body?.message ?? 'Some rows could not be filed.'} ${lines.join(' ')}`;
  }

  private periodLabelFor(quarter: number): string {
    const view = this.view();
    return `${view?.grading.period_label ?? 'Period'} ${quarter}`;
  }

  protected saveManualDetails(): void {
    const manual = this.manageSubject();
    if (!manual) return;
    const subjectName = this.manageName().trim();
    const teacherName = this.manageTeacher().trim();
    if (!subjectName || !teacherName) {
      this.manageError.set('Enter the subject name and the subject teacher\u2019s name.');
      return;
    }
    if (subjectName === manual.subject_name && teacherName === manual.teacher_name) return;
    this.savingDetails.set(true);
    this.manageError.set('');
    this.consolidation
      .updateManualSubject(manual.id, { subject_name: subjectName, teacher_name: teacherName })
      .subscribe({
        next: (response) => {
          this.savingDetails.set(false);
          this.manageSubject.set(response.manual_subject);
          this.toast.success('Manual subject updated.');
          this.load(this.quarter());
        },
        error: (error) => {
          this.savingDetails.set(false);
          this.manageError.set(errorMessage(error));
        },
      });
  }

  protected deleteManual(): void {
    const manual = this.manageSubject();
    if (!manual) return;
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    this.deleting.set(true);
    this.consolidation.deleteManualSubject(manual.id).subscribe({
      next: (response) => {
        this.deleting.set(false);
        this.closeManage();
        this.toast.success(response.message);
        this.load(this.quarter());
      },
      error: (error) => {
        this.deleting.set(false);
        this.manageError.set(errorMessage(error));
      },
    });
  }

  protected exportCsv(): void {
    const view = this.view();
    if (!view) return;
    const safe = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    const section = view.section ? safe(view.section) : 'section';
    const periodShort = view.grading.period_short.toLowerCase();
    this.consolidation.exportCsv(this.quarter(), `consolidation-g${view.grade}-${section}-${periodShort}${this.quarter()}.csv`, this.year.selectedYear() ?? undefined);
  }

  protected exportFinalsCsv(): void {
    const view = this.view();
    if (!view) return;
    const safe = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    const section = view.section ? safe(view.section) : 'section';
    this.consolidation.exportFinalsCsv(`consolidation-final-g${view.grade}-${section}.csv`, this.year.selectedYear() ?? undefined);
  }

  protected fmt(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return String(Math.round(value * 100) / 100);
  }

  protected gwa(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return value.toFixed(2);
  }

  protected learnerName(learner: { first_name: string; last_name: string }): string {
    return `${learner.last_name}, ${learner.first_name}`;
  }
}
