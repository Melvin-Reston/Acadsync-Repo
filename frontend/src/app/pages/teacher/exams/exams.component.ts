// Paper exam checker (Batch 10): the teacher's paper exams. An exam
// belongs to one class and one period, carries one answer key for the
// whole exam — each question with its own 2 to 5 choices, a 2-choice
// question optionally True/False — and prints one answer sheet per
// learner. A sheet photo is read in the browser by core/omr.ts and
// never uploaded: the teacher reviews and corrects the answers, then
// saves them, and the server recomputes the score from its own key
// into an Examinations column in the Grades page.
import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClassesService } from '../../../core/classes.service';
import { errorMessage, fieldErrors } from '../../../core/helpers';
import { ClassItem, Exam, ExamDetail, ExamQuestion, FieldErrors } from '../../../core/models';
import { ExamsService } from '../../../core/exams.service';
import { ToastService } from '../../../core/toast.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';
import { PaginationComponent } from '../../../shared/pagination.component';
import { OMR_HEIGHT, OMR_WIDTH, OmrResult, bubbleCenter, questionLabels, readSheet } from '../../../core/omr';
import { ExamSheetComponent, SheetLearner } from './exam-sheet.component';

function periodLabelForYear(academicYear: string | null | undefined): string {
  const start = Number(String(academicYear || '').slice(0, 4));
  return !Number.isNaN(start) && start < 2026 ? 'Quarter' : 'Term';
}

function periodsForYear(academicYear: string | null | undefined): number[] {
  return periodLabelForYear(academicYear) === 'Quarter' ? [1, 2, 3, 4] : [1, 2, 3];
}

async function loadGrayscale(file: File, maxWidth: number): Promise<{ gray: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not read the photo.');
  context.drawImage(bitmap, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < gray.length; i += 1, j += 4) {
    gray[i] = Math.round(0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2]);
  }
  bitmap.close();
  return { gray, width, height };
}

@Component({
  selector: 'app-teacher-exams',
  imports: [FormsModule, RouterLink, DropdownComponent, IconComponent, ModalComponent, ExamSheetComponent, PaginationComponent],
  templateUrl: './exams.component.html',
  styleUrl: './exams.component.css',
})
export class TeacherExamsComponent {
  private readonly examsService = inject(ExamsService);
  private readonly classesService = inject(ClassesService);
  private readonly toast = inject(ToastService);
  protected readonly year = inject(ViewingYearService);
  private readonly previewCanvas = viewChild<ElementRef<HTMLCanvasElement>>('previewCanvas');

  // Inside the merged Quizzes & Exams page the wrapper owns the page
  // head and the tabs, so this component hides its own head there.
  readonly embedded = input(false);

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly exams = signal<Exam[]>([]);
  protected readonly classes = signal<ClassItem[]>([]);
  protected readonly classFilter = signal<number | null>(null);

  protected readonly createOpen = signal(false);
  protected readonly savingExam = signal(false);
  protected readonly formErrors = signal<FieldErrors>({});
  protected readonly newClassId = signal<number | null>(null);
  protected readonly newQuarter = signal<number | null>(null);
  protected readonly newExamNumber = signal(1);
  protected readonly newTitle = signal('');
  protected readonly newInstructions = signal('');
  protected readonly newQuestionCount = signal(20);
  protected readonly newPointsEach = signal(1);

  protected readonly detail = signal<ExamDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly savingDetail = signal(false);
  protected readonly detailErrors = signal<FieldErrors>({});
  protected readonly editTitle = signal('');
  protected readonly editInstructions = signal('');
  protected readonly editQuestionCount = signal(20);
  protected readonly editPointsEach = signal(1);
  protected readonly rosterSearch = signal('');

  protected readonly keyDraft = signal<ExamQuestion[]>([]);
  protected readonly keyInput = signal('');
  protected readonly keyError = signal('');
  protected readonly savingKey = signal(false);
  // The key editor shows 10 questions per page: a 35-item key is one
  // long grid otherwise. Paging is view-only — the draft holds every
  // question, so edits on one page survive paging to another.
  protected readonly keyPageSize = 10;
  protected readonly keyPage = signal(0);

  // How many choices a question has, picked from the dropdown at the
  // right end of each key row.
  protected readonly choiceCountOptions: DropdownOption[] = [
    { value: 2, label: '2 choices' },
    { value: 3, label: '3 choices' },
    { value: 4, label: '4 choices' },
    { value: 5, label: '5 choices' },
  ];

  protected readonly deleteExamConfirm = signal(false);
  protected readonly deleteScanId = signal<number | null>(null);
  protected readonly busy = signal(false);

  // Printing: the sheets to print are rendered in the print-only
  // section; the preview shows one learner's sheet on screen.
  protected readonly printLearners = signal<SheetLearner[]>([]);
  protected readonly previewLearnerId = signal<number | null>(null);

  // Checking: one learner, one photo, one reviewed answer grid.
  protected readonly checkLearnerId = signal<number | null>(null);
  protected readonly checkPhotoName = signal('');
  protected readonly reading = signal(false);
  protected readonly readError = signal('');
  protected readonly omrResult = signal<OmrResult | null>(null);
  protected readonly reviewAnswers = signal<(number | null)[]>([]);
  protected readonly reviewFlags = signal<{ uncertain: boolean; multiple: boolean }[]>([]);
  protected readonly reviewSource = signal<'photo' | 'manual'>('photo');
  protected readonly reviewStarted = signal(false);
  protected readonly savingScan = signal(false);
  protected readonly scanError = signal('');

  protected readonly classOptions = computed<DropdownOption[]>(() =>
    this.classes().map((klass) => ({
      value: klass.id,
      label: `${klass.subject_name} · ${klass.section_name}`,
      sub: `Grade ${klass.grade_level} · ${klass.academic_year}`,
    }))
  );

  protected readonly periodOptions = computed<DropdownOption[]>(() => {
    const klass = this.classes().find((item) => item.id === this.newClassId());
    const label = periodLabelForYear(klass?.academic_year ?? this.year.selectedYear());
    return periodsForYear(klass?.academic_year ?? this.year.selectedYear()).map((period) => ({
      value: period,
      label: `${label} ${period}`,
    }));
  });

  protected readonly filteredExams = computed(() => {
    const classId = this.classFilter();
    return this.exams().filter((exam) => classId === null || exam.class_id === classId);
  });

  protected readonly detailPeriodLabel = computed(() => {
    const detail = this.detail();
    if (!detail) return 'Term';
    return detail.grading.period_label;
  });

  // The choice labels for one question of the key draft or the stored
  // key: T/F for a True/False question, letters otherwise.
  protected questionLabels(question: ExamQuestion): string[] {
    return questionLabels(question);
  }

  protected draftQuestion(question: number): ExamQuestion {
    return this.keyDraft()[question] ?? { choices: 4, correct: null, kind: 'mcq' };
  }

  protected storedQuestion(question: number): ExamQuestion {
    const detail = this.detail();
    return detail?.exam.questions[question] ?? { choices: 4, correct: null, kind: 'mcq' };
  }

  protected readonly rosterRows = computed(() => {
    const query = this.rosterSearch().trim().toLowerCase();
    const rows = this.detail()?.roster ?? [];
    if (!query) return rows;
    return rows.filter((row) => `${row.first_name} ${row.last_name} ${row.learner_id}`.toLowerCase().includes(query));
  });

  protected readonly checkLearnerOptions = computed<DropdownOption[]>(() =>
    (this.detail()?.roster ?? []).map((row) => ({
      value: row.id,
      label: `${row.last_name}, ${row.first_name}`,
      sub: `${row.learner_id}${row.scan ? ' · Checked' : ''}`,
    }))
  );

  protected readonly previewLearner = computed<SheetLearner | null>(() => {
    const detail = this.detail();
    const id = this.previewLearnerId();
    if (!detail || id === null) return null;
    const row = detail.roster.find((entry) => entry.id === id);
    return row ? { first_name: row.first_name, last_name: row.last_name, learner_id: row.learner_id } : null;
  });

  protected readonly keyLocked = computed(() => (this.detail()?.exam.scan_count ?? 0) > 0);

  protected readonly reviewScore = computed(() => {
    const detail = this.detail();
    if (!detail || !detail.exam.key_complete) return null;
    const answers = this.reviewAnswers();
    let correct = 0;
    answers.forEach((answer, index) => {
      if (answer !== null && answer !== undefined && answer === detail.exam.questions[index]?.correct) correct += 1;
    });
    return { correct, total: detail.exam.question_count, score: correct * detail.exam.points_each, totalPoints: detail.exam.total_points };
  });

  constructor() {
    effect(() => {
      const selected = this.year.selectedYear();
      if (selected || this.year.loaded()) this.load();
    });
  }

  protected periodLabel(exam: Exam): string {
    return periodLabelForYear(exam.academic_year);
  }

  protected load(): void {
    const selectedYear = this.year.selectedYear();
    this.loading.set(true);
    this.loadError.set('');
    this.classesService.classes({ academic_year: selectedYear ?? '' }).subscribe({
      next: (response) => this.classes.set(response.items),
      error: (error: unknown) => {
        this.loadError.set(errorMessage(error));
        this.loading.set(false);
      },
    });
    this.examsService.list({ academic_year: selectedYear ?? '' }).subscribe({
      next: (response) => {
        this.exams.set(response.items);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(errorMessage(error));
        this.loading.set(false);
      },
    });
  }

  protected openCreate(): void {
    this.formErrors.set({});
    this.newClassId.set(this.classes()[0]?.id ?? null);
    this.newQuarter.set(1);
    this.newExamNumber.set(this.nextExamNumber());
    this.newTitle.set('');
    this.newInstructions.set('');
    this.newQuestionCount.set(20);
    this.newPointsEach.set(1);
    this.createOpen.set(true);
  }

  protected nextExamNumber(): number {
    const classId = this.newClassId();
    const quarter = this.newQuarter();
    const used = this.exams()
      .filter((exam) => exam.class_id === classId && exam.quarter === quarter)
      .map((exam) => exam.exam_number);
    let number = 1;
    while (used.includes(number) && number < 20) number += 1;
    return number;
  }

  protected onNewClassChange(value: string | number): void {
    this.newClassId.set(value === '' ? null : Number(value));
    this.newQuarter.set(1);
    this.newExamNumber.set(this.nextExamNumber());
  }

  protected onNewQuarterChange(value: string | number): void {
    this.newQuarter.set(value === '' ? null : Number(value));
    this.newExamNumber.set(this.nextExamNumber());
  }

  protected onClassFilterChange(value: string | number): void {
    this.classFilter.set(value === '' ? null : Number(value));
  }

  // Number inputs send strings: templates cannot call the Number
  // global, so these small setters do the conversion in one place.
  protected setNewExamNumber(value: string | number): void {
    this.newExamNumber.set(Number(value) || 1);
  }

  protected setNewQuestionCount(value: string | number): void {
    this.newQuestionCount.set(Number(value) || 5);
  }

  protected setNewPointsEach(value: string | number): void {
    this.newPointsEach.set(Number(value) || 1);
  }

  protected setEditQuestionCount(value: string | number): void {
    this.editQuestionCount.set(Number(value) || 5);
  }

  protected setEditPointsEach(value: string | number): void {
    this.editPointsEach.set(Number(value) || 1);
  }

  protected createExam(): void {
    const classId = this.newClassId();
    const quarter = this.newQuarter();
    if (!classId || !quarter) {
      this.formErrors.set({ class_id: 'Choose a class.' });
      return;
    }
    this.savingExam.set(true);
    this.examsService
      .create({
        class_id: classId,
        quarter,
        exam_number: this.newExamNumber(),
        title: this.newTitle().trim(),
        instructions: this.newInstructions().trim(),
        question_count: this.newQuestionCount(),
        points_each: this.newPointsEach(),
      })
      .subscribe({
        next: (response) => {
          this.savingExam.set(false);
          this.createOpen.set(false);
          this.toast.success(`Exam ${response.exam.exam_number} created. Enter its answer key, then print the sheets.`);
          this.load();
          this.openDetail(response.exam.id);
        },
        error: (error: unknown) => {
          this.savingExam.set(false);
          this.formErrors.set(fieldErrors(error));
          this.toast.error(errorMessage(error));
        },
      });
  }

  protected openDetail(id: number): void {
    this.detailLoading.set(true);
    this.examsService.detail(id).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.editTitle.set(detail.exam.title);
        this.editInstructions.set(detail.exam.instructions);
        this.editQuestionCount.set(detail.exam.question_count);
        this.editPointsEach.set(detail.exam.points_each);
        this.initKeyDraft(detail.exam);
        this.previewLearnerId.set(detail.roster[0]?.id ?? null);
        this.checkLearnerId.set(detail.roster.find((row) => !row.scan)?.id ?? detail.roster[0]?.id ?? null);
        this.clearChecker();
        this.detailLoading.set(false);
      },
      error: (error: unknown) => {
        this.detailLoading.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected backToList(): void {
    this.detail.set(null);
    this.load();
  }

  protected initKeyDraft(exam: Exam): void {
    const draft: ExamQuestion[] = Array.from({ length: exam.question_count }, (_, index) => ({
      ...(exam.questions[index] ?? { choices: 4, correct: null, kind: 'mcq' as const }),
    }));
    this.keyDraft.set(draft);
    this.keyInput.set('');
    this.keyError.set('');
    this.keyPage.set(0);
  }

  protected keyPageRows(): { entry: ExamQuestion; index: number }[] {
    const start = this.keyPage() * this.keyPageSize;
    return this.keyDraft()
      .slice(start, start + this.keyPageSize)
      .map((entry, offset) => ({ entry, index: start + offset }));
  }

  protected setKeyPage(page: number): void {
    const pages = Math.max(1, Math.ceil(this.keyDraft().length / this.keyPageSize));
    this.keyPage.set(Math.min(Math.max(0, page), pages - 1));
  }

  protected setKeyAnswer(question: number, choice: number | null): void {
    const draft = this.keyDraft().map((entry) => ({ ...entry }));
    draft[question] = { ...draft[question], correct: choice };
    this.keyDraft.set(draft);
    this.keyError.set('');
  }

  // The choices dropdown hands back its option value; only the four
  // real counts change the draft.
  protected setQuestionChoicesOption(question: number, value: string | number | null): void {
    const count = Number(value);
    if ([2, 3, 4, 5].includes(count)) this.setQuestionChoices(question, count);
  }

  // Changing how many choices a question has clears its answer when
  // the answer would no longer exist, and drops True/False when the
  // question grows past 2 choices.
  protected setQuestionChoices(question: number, count: number): void {
    const draft = this.keyDraft().map((entry) => ({ ...entry }));
    const entry = { ...draft[question], choices: count };
    if (entry.correct !== null && entry.correct >= count) entry.correct = null;
    if (count !== 2) entry.kind = 'mcq';
    draft[question] = entry;
    this.keyDraft.set(draft);
    this.keyError.set('');
  }

  protected setQuestionKind(question: number, kind: 'mcq' | 'true_false'): void {
    const draft = this.keyDraft().map((entry) => ({ ...entry }));
    const entry = { ...draft[question], kind };
    if (kind === 'true_false') {
      entry.choices = 2;
      if (entry.correct !== null && entry.correct > 1) entry.correct = null;
    }
    draft[question] = entry;
    this.keyDraft.set(draft);
    this.keyError.set('');
  }

  protected applyKeyString(): void {
    const detail = this.detail();
    if (!detail) return;
    const raw = this.keyInput()
      .toUpperCase()
      .replace(/[^A-ETF]/g, '');
    const draft = this.keyDraft().map((entry) => ({ ...entry }));
    for (let i = 0; i < Math.min(raw.length, draft.length); i += 1) {
      const entry = draft[i];
      const letters = entry.kind === 'true_false' ? ['T', 'F'] : ['A', 'B', 'C', 'D', 'E'];
      const index = letters.indexOf(raw[i]);
      if (index >= 0 && index < entry.choices) entry.correct = index;
    }
    this.keyDraft.set(draft);
    this.keyError.set(raw.length > detail.exam.question_count ? `Only the first ${detail.exam.question_count} letters were used.` : '');
  }

  protected saveKey(): void {
    const detail = this.detail();
    if (!detail) return;
    const draft = this.keyDraft();
    if (draft.length !== detail.exam.question_count) {
      this.keyError.set('The key needs one entry per question.');
      return;
    }
    this.savingKey.set(true);
    this.examsService.saveKey(detail.exam.id, draft).subscribe({
      next: (response) => {
        this.savingKey.set(false);
        this.toast.success(response.message);
        this.openDetail(detail.exam.id);
        this.load();
      },
      error: (error: unknown) => {
        this.savingKey.set(false);
        this.keyError.set(errorMessage(error));
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected saveDetails(): void {
    const detail = this.detail();
    if (!detail) return;
    this.savingDetail.set(true);
    this.detailErrors.set({});
    const body: { title?: string; instructions?: string; question_count?: number; points_each?: number } = {
      title: this.editTitle().trim(),
      instructions: this.editInstructions().trim(),
    };
    if (!this.keyLocked()) {
      if (this.editQuestionCount() !== detail.exam.question_count) body.question_count = this.editQuestionCount();
      if (this.editPointsEach() !== detail.exam.points_each) body.points_each = this.editPointsEach();
    }
    this.examsService.update(detail.exam.id, body).subscribe({
      next: () => {
        this.savingDetail.set(false);
        this.toast.success('Exam details saved.');
        this.openDetail(detail.exam.id);
        this.load();
      },
      error: (error: unknown) => {
        this.savingDetail.set(false);
        this.detailErrors.set(fieldErrors(error));
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected confirmDeleteExam(): void {
    const detail = this.detail();
    if (!detail) return;
    this.busy.set(true);
    this.examsService.remove(detail.exam.id).subscribe({
      next: (response) => {
        this.busy.set(false);
        this.deleteExamConfirm.set(false);
        this.toast.success(response.message);
        this.backToList();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  // ---------- Printing ----------

  protected printOne(): void {
    const learner = this.previewLearner();
    if (!learner) return;
    this.printLearners.set([learner]);
    setTimeout(() => window.print(), 120);
  }

  protected printAll(): void {
    const detail = this.detail();
    if (!detail) return;
    this.printLearners.set(
      detail.roster.map((row) => ({ first_name: row.first_name, last_name: row.last_name, learner_id: row.learner_id }))
    );
    setTimeout(() => window.print(), 120);
  }

  protected onPreviewLearnerChange(value: string | number): void {
    this.previewLearnerId.set(value === '' ? null : Number(value));
  }

  // ---------- Checking ----------

  protected clearChecker(): void {
    this.checkPhotoName.set('');
    this.reading.set(false);
    this.readError.set('');
    this.omrResult.set(null);
    this.reviewAnswers.set([]);
    this.reviewFlags.set([]);
    this.reviewSource.set('photo');
    this.reviewStarted.set(false);
    this.scanError.set('');
  }

  protected onCheckLearnerChange(value: string | number): void {
    this.checkLearnerId.set(value === '' ? null : Number(value));
    this.clearChecker();
  }

  protected async onPhotoSelected(event: Event): Promise<void> {
    const detail = this.detail();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!detail || !file) return;
    this.checkPhotoName.set(file.name);
    this.readError.set('');
    this.reading.set(true);
    // Let the "Reading…" state paint before the heavy warp runs.
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const image = await loadGrayscale(file, 1600);
      const result = readSheet(image.gray, image.width, image.height, detail.exam.questions);
      this.omrResult.set(result);
      this.reviewAnswers.set(result.answers.map((answer) => answer.selected));
      this.reviewFlags.set(result.answers.map((answer) => ({ uncertain: answer.uncertain, multiple: answer.multiple })));
      this.reviewSource.set('photo');
      this.reviewStarted.set(true);
      setTimeout(() => this.drawPreview(result), 0);
    } catch {
      this.readError.set('That photo could not be read. Try a clearer photo, or enter the answers by hand below.');
    } finally {
      this.reading.set(false);
      input.value = '';
    }
  }

  protected startManualEntry(): void {
    const detail = this.detail();
    if (!detail) return;
    this.omrResult.set(null);
    this.reviewAnswers.set(Array.from({ length: detail.exam.question_count }, () => null));
    this.reviewFlags.set(Array.from({ length: detail.exam.question_count }, () => ({ uncertain: false, multiple: false })));
    this.reviewSource.set('manual');
    this.reviewStarted.set(true);
    this.readError.set('');
  }

  protected loadSavedAnswers(): void {
    const detail = this.detail();
    const learnerId = this.checkLearnerId();
    if (!detail || learnerId === null) return;
    const scan = detail.scans.find((entry) => entry.learner_id === learnerId);
    if (!scan) return;
    this.omrResult.set(null);
    this.reviewAnswers.set(scan.answers.map((answer) => answer.selected));
    this.reviewFlags.set(scan.answers.map((answer) => ({ uncertain: answer.uncertain, multiple: answer.multiple })));
    this.reviewSource.set(scan.source);
    this.reviewStarted.set(true);
  }

  protected setReviewAnswer(question: number, choice: number | null): void {
    const answers = [...this.reviewAnswers()];
    answers[question] = choice;
    this.reviewAnswers.set(answers);
    const flags = [...this.reviewFlags()];
    flags[question] = { uncertain: false, multiple: false };
    this.reviewFlags.set(flags);
  }

  protected saveScan(): void {
    const detail = this.detail();
    const learnerId = this.checkLearnerId();
    if (!detail || learnerId === null) return;
    if (!detail.exam.key_complete) {
      this.scanError.set('Finish the answer key first.');
      return;
    }
    const answers = this.reviewAnswers();
    if (answers.length !== detail.exam.question_count) {
      this.scanError.set('Check every question first, even the blank ones.');
      return;
    }
    this.savingScan.set(true);
    this.scanError.set('');
    this.examsService
      .saveScan(detail.exam.id, {
        learner_id: learnerId,
        answers: answers.map((selected, index) => ({
          selected,
          uncertain: this.reviewFlags()[index]?.uncertain ?? false,
          multiple: this.reviewFlags()[index]?.multiple ?? false,
        })),
        source: this.reviewSource(),
      })
      .subscribe({
        next: (response) => {
          this.savingScan.set(false);
          this.toast.success(response.message);
          this.clearChecker();
          this.openDetail(detail.exam.id);
          this.load();
        },
        error: (error: unknown) => {
          this.savingScan.set(false);
          this.scanError.set(errorMessage(error));
          this.toast.error(errorMessage(error));
        },
      });
  }

  protected confirmDeleteScan(): void {
    const detail = this.detail();
    const scanId = this.deleteScanId();
    if (!detail || scanId === null) return;
    this.busy.set(true);
    this.examsService.deleteScan(detail.exam.id, scanId).subscribe({
      next: (response) => {
        this.busy.set(false);
        this.deleteScanId.set(null);
        this.toast.success(response.message);
        this.openDetail(detail.exam.id);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected downloadResults(): void {
    const detail = this.detail();
    if (!detail) return;
    const safe = (value: string): string => value.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    this.examsService.downloadResults(
      detail.exam.id,
      `exam-${detail.exam.exam_number}-${safe(detail.exam.subject_name)}-${safe(detail.exam.section_name)}.csv`
    );
  }

  protected questionStat(position: number): { attempts: number; correct: number } | undefined {
    return this.detail()?.question_stats.find((stat) => stat.position === position);
  }

  protected checkedLearnerName(): string {
    const detail = this.detail();
    const learnerId = this.checkLearnerId();
    const row = detail?.roster.find((entry) => entry.id === learnerId);
    return row ? `${row.last_name}, ${row.first_name}` : '';
  }

  protected hasSavedScan(): boolean {
    const detail = this.detail();
    const learnerId = this.checkLearnerId();
    return detail?.scans.some((scan) => scan.learner_id === learnerId) ?? false;
  }

  // The warped sheet, with the read answers drawn over it: a ring
  // around the circle the checker picked, dashed when it was unsure.
  protected drawPreview(result: OmrResult, attempt = 0): void {
    const canvasRef = this.previewCanvas();
    if (!canvasRef) {
      // The canvas renders with the result: try again shortly, a few
      // times, rather than leaving the preview blank.
      if (attempt < 5) setTimeout(() => this.drawPreview(result, attempt + 1), 100);
      return;
    }
    const canvas = canvasRef.nativeElement;
    const displayWidth = 600;
    const displayHeight = Math.round((displayWidth * OMR_HEIGHT) / OMR_WIDTH);
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    const source = document.createElement('canvas');
    source.width = OMR_WIDTH;
    source.height = OMR_HEIGHT;
    const sourceContext = source.getContext('2d');
    if (!sourceContext) return;
    const imageData = sourceContext.createImageData(OMR_WIDTH, OMR_HEIGHT);
    for (let i = 0; i < result.canonicalGray.length; i += 1) {
      const value = result.canonicalGray[i];
      imageData.data[i * 4] = value;
      imageData.data[i * 4 + 1] = value;
      imageData.data[i * 4 + 2] = value;
      imageData.data[i * 4 + 3] = 255;
    }
    sourceContext.putImageData(imageData, 0, 0);
    context.drawImage(source, 0, 0, displayWidth, displayHeight);
    const scale = displayWidth / OMR_WIDTH;
    context.lineWidth = 3;
    result.answers.forEach((answer, question) => {
      if (answer.selected === null) return;
      const exam = this.detail()?.exam;
      if (!exam) return;
      const centre = bubbleCenter(question, answer.selected, exam.question_count);
      context.beginPath();
      context.arc(centre.x * scale, centre.y * scale, 17 * scale, 0, Math.PI * 2);
      context.strokeStyle = answer.uncertain ? '#b91c1c' : '#9a3412';
      context.setLineDash(answer.uncertain ? [5, 4] : []);
      context.stroke();
      context.setLineDash([]);
    });
  }
}
