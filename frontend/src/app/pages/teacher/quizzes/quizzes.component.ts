// Online quizzes (Batch 9): the teacher's quizzes. A quiz belongs to one
// class and one period, carries numbered questions with an answer key,
// and is shared by a link. Publishing writes the learners' scores into a
// Written Works column in the Grades page, labelled with the quiz number.
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ClassesService } from '../../../core/classes.service';
import { errorMessage, fieldErrors } from '../../../core/helpers';
import { ClassItem, FieldErrors, Quiz, QuizDetail, QuizQuestion, QuizQuestionType } from '../../../core/models';
import { QuizzesService } from '../../../core/quizzes.service';
import { ToastService } from '../../../core/toast.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';

type QuestionDraft = {
  question_type: QuizQuestionType;
  question_text: string;
  options: string[];
  correct_index: number;
  points: number;
};

function periodLabelForYear(academicYear: string | null | undefined): string {
  const start = Number(String(academicYear || '').slice(0, 4));
  return !Number.isNaN(start) && start < 2026 ? 'Quarter' : 'Term';
}

function periodsForYear(academicYear: string | null | undefined): number[] {
  return periodLabelForYear(academicYear) === 'Quarter' ? [1, 2, 3, 4] : [1, 2, 3];
}

@Component({
  selector: 'app-teacher-quizzes',
  imports: [FormsModule, RouterLink, DropdownComponent, IconComponent, ModalComponent],
  templateUrl: './quizzes.component.html',
  styleUrl: './quizzes.component.css',
})
export class TeacherQuizzesComponent {
  private readonly quizzesService = inject(QuizzesService);
  private readonly classesService = inject(ClassesService);
  private readonly toast = inject(ToastService);
  protected readonly year = inject(ViewingYearService);

  // Inside the merged Quizzes & Exams page the wrapper owns the page
  // head and the tabs, so this component hides its own head there.
  readonly embedded = input(false);

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly quizzes = signal<Quiz[]>([]);
  protected readonly classes = signal<ClassItem[]>([]);

  protected readonly classFilter = signal<number | null>(null);
  protected readonly statusFilter = signal('');

  protected readonly createOpen = signal(false);
  protected readonly savingQuiz = signal(false);
  protected readonly formErrors = signal<FieldErrors>({});
  protected readonly newClassId = signal<number | null>(null);
  protected readonly newQuarter = signal<number | null>(null);
  protected readonly newQuizNumber = signal(1);
  protected readonly newTitle = signal('');
  protected readonly newInstructions = signal('');

  protected readonly detail = signal<QuizDetail | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly savingDetail = signal(false);
  protected readonly detailErrors = signal<FieldErrors>({});
  protected readonly editTitle = signal('');
  protected readonly editInstructions = signal('');
  protected readonly editDeadline = signal('');
  protected readonly rosterSearch = signal('');

  protected readonly editingQuestionId = signal<number | null>(null);
  protected readonly questionForm = signal<QuestionDraft>({
    question_type: 'mcq',
    question_text: '',
    options: ['', ''],
    correct_index: 0,
    points: 1,
  });
  protected readonly questionErrors = signal<FieldErrors>({});
  protected readonly savingQuestion = signal(false);

  protected readonly deleteQuizConfirm = signal(false);
  protected readonly deleteQuestionId = signal<number | null>(null);
  protected readonly resetAttemptId = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly copied = signal(false);

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

  protected readonly filteredQuizzes = computed(() => {
    const classId = this.classFilter();
    const status = this.statusFilter();
    return this.quizzes().filter(
      (quiz) => (classId === null || quiz.class_id === classId) && (status === '' || quiz.status === status)
    );
  });

  protected readonly detailPeriodLabel = computed(() => {
    const detail = this.detail();
    if (!detail) return 'Term';
    return detail.grading.period_label;
  });

  protected readonly rosterRows = computed(() => {
    const query = this.rosterSearch().trim().toLowerCase();
    const rows = this.detail()?.roster ?? [];
    if (!query) return rows;
    return rows.filter((row) => `${row.first_name} ${row.last_name} ${row.learner_id}`.toLowerCase().includes(query));
  });

  protected readonly questionsLocked = computed(() => (this.detail()?.quiz.attempt_count ?? 0) > 0);

  protected readonly quizLink = computed(() => {
    const detail = this.detail();
    return detail ? `${window.location.origin}/quiz/${detail.quiz.code}` : '';
  });

  constructor() {
    effect(() => {
      const selected = this.year.selectedYear();
      if (selected || this.year.loaded()) this.load();
    });
  }

  protected periodLabel(quiz: Quiz): string {
    return periodLabelForYear(quiz.academic_year);
  }

  protected statusLabel(status: Quiz['status']): string {
    return status === 'draft' ? 'Draft' : status === 'published' ? 'Published' : 'Closed';
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
    this.quizzesService.list({ academic_year: selectedYear ?? '' }).subscribe({
      next: (response) => {
        this.quizzes.set(response.items);
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
    this.newQuizNumber.set(this.nextQuizNumber());
    this.newTitle.set('');
    this.newInstructions.set('');
    this.createOpen.set(true);
  }

  protected nextQuizNumber(): number {
    const classId = this.newClassId();
    const quarter = this.newQuarter();
    const used = this.quizzes()
      .filter((quiz) => quiz.class_id === classId && quiz.quarter === quarter)
      .map((quiz) => quiz.quiz_number);
    let number = 1;
    while (used.includes(number) && number < 20) number += 1;
    return number;
  }

  protected onCreateClassChange(): void {
    this.newQuarter.set(1);
    this.newQuizNumber.set(this.nextQuizNumber());
  }

  protected onNewClassChange(value: string | number): void {
    this.newClassId.set(value === '' ? null : Number(value));
    this.onCreateClassChange();
  }

  protected onNewQuarterChange(value: string | number): void {
    this.newQuarter.set(value === '' ? null : Number(value));
    this.newQuizNumber.set(this.nextQuizNumber());
  }

  protected setCorrect(index: number): void {
    const form = this.questionForm();
    this.questionForm.set({ ...form, correct_index: Number(index) });
  }

  protected onClassFilterChange(value: string | number): void {
    this.classFilter.set(value === '' ? null : Number(value));
  }

  protected setPoints(value: string | number): void {
    const form = this.questionForm();
    this.questionForm.set({ ...form, points: Number(value) });
  }

  protected setQuizNumber(value: string | number): void {
    this.newQuizNumber.set(Number(value));
  }

  protected createQuiz(): void {
    const classId = this.newClassId();
    const quarter = this.newQuarter();
    if (!classId || !quarter) {
      this.formErrors.set({ class_id: 'Choose a class.' });
      return;
    }
    this.savingQuiz.set(true);
    this.quizzesService
      .create({
        class_id: classId,
        quarter,
        quiz_number: this.newQuizNumber(),
        title: this.newTitle().trim(),
        instructions: this.newInstructions().trim(),
      })
      .subscribe({
        next: (response) => {
          this.savingQuiz.set(false);
          this.createOpen.set(false);
          this.toast.success(`Quiz ${response.quiz.quiz_number} created. Add its questions, then publish it.`);
          this.load();
          this.openDetail(response.quiz.id);
        },
        error: (error: unknown) => {
          this.savingQuiz.set(false);
          this.formErrors.set(fieldErrors(error));
          this.toast.error(errorMessage(error));
        },
      });
  }

  protected openDetail(id: number): void {
    this.detailLoading.set(true);
    this.quizzesService.detail(id).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.editTitle.set(detail.quiz.title);
        this.editInstructions.set(detail.quiz.instructions);
        this.editDeadline.set(toLocalInput(detail.quiz.deadline));
        this.editingQuestionId.set(null);
        this.resetQuestionForm();
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

  protected saveDetails(): void {
    const detail = this.detail();
    if (!detail) return;
    const deadlineInput = this.editDeadline().trim();
    const body: { title: string; instructions: string; deadline?: string; clear_deadline?: boolean } = {
      title: this.editTitle().trim(),
      instructions: this.editInstructions().trim(),
    };
    if (deadlineInput) body.deadline = new Date(deadlineInput).toISOString();
    else if (detail.quiz.deadline) body.clear_deadline = true;
    this.savingDetail.set(true);
    this.quizzesService.update(detail.quiz.id, body).subscribe({
      next: (response) => {
        this.savingDetail.set(false);
        this.detail.update((current) => (current ? { ...current, quiz: response.quiz } : current));
        this.toast.success('Quiz details saved.');
        this.load();
      },
      error: (error: unknown) => {
        this.savingDetail.set(false);
        this.detailErrors.set(fieldErrors(error));
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected publish(): void {
    const detail = this.detail();
    if (!detail) return;
    this.busy.set(true);
    this.quizzesService.publish(detail.quiz.id).subscribe({
      next: (response) => {
        this.busy.set(false);
        this.toast.success(response.message);
        this.openDetail(detail.quiz.id);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected closeQuiz(): void {
    const detail = this.detail();
    if (!detail) return;
    this.busy.set(true);
    this.quizzesService.close(detail.quiz.id).subscribe({
      next: (response) => {
        this.busy.set(false);
        this.toast.success(response.message);
        this.openDetail(detail.quiz.id);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected confirmDeleteQuiz(): void {
    const detail = this.detail();
    if (!detail) return;
    this.busy.set(true);
    this.quizzesService.remove(detail.quiz.id).subscribe({
      next: (response) => {
        this.busy.set(false);
        this.deleteQuizConfirm.set(false);
        this.toast.success(response.message);
        this.backToList();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected async copyLink(): Promise<void> {
    const link = this.quizLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2500);
      this.toast.success('Quiz link copied. Send it to your learners.');
    } catch {
      this.toast.error('Copy the link from the box below.');
    }
  }

  // ---------- Questions ----------

  protected resetQuestionForm(): void {
    this.questionErrors.set({});
    this.questionForm.set({ question_type: 'mcq', question_text: '', options: ['', ''], correct_index: 0, points: 1 });
  }

  protected startEditQuestion(question: QuizQuestion): void {
    this.editingQuestionId.set(question.id);
    this.questionErrors.set({});
    this.questionForm.set({
      question_type: question.question_type,
      question_text: question.question_text,
      options: question.question_type === 'true_false' ? ['', ''] : [...question.options],
      correct_index: question.correct_index ?? 0,
      points: question.points,
    });
  }

  protected cancelEditQuestion(): void {
    this.editingQuestionId.set(null);
    this.resetQuestionForm();
  }

  protected setQuestionType(type: QuizQuestionType): void {
    const form = this.questionForm();
    this.questionForm.set({ ...form, question_type: type, correct_index: 0, options: type === 'true_false' ? ['', ''] : form.options });
  }

  protected addChoice(): void {
    const form = this.questionForm();
    if (form.options.length < 5) this.questionForm.set({ ...form, options: [...form.options, ''] });
  }

  protected removeChoice(index: number): void {
    const form = this.questionForm();
    if (form.options.length <= 2) return;
    const options = form.options.filter((_, i) => i !== index);
    this.questionForm.set({ ...form, options, correct_index: Math.min(form.correct_index, options.length - 1) });
  }

  protected updateChoice(index: number, value: string): void {
    const form = this.questionForm();
    const options = [...form.options];
    options[index] = value;
    this.questionForm.set({ ...form, options });
  }

  protected saveQuestion(): void {
    const detail = this.detail();
    if (!detail) return;
    const form = this.questionForm();
    const options = form.question_type === 'true_false' ? [] : form.options.map((option) => option.trim());
    const body = {
      question_type: form.question_type,
      question_text: form.question_text.trim(),
      // True/False always carries True and False; choices sent with it are ignored.
      options: form.question_type === 'true_false' ? [] : options,
      correct_index: form.correct_index,
      points: form.points,
    };
    this.savingQuestion.set(true);
    const editingId = this.editingQuestionId();
    const request =
      editingId === null
        ? this.quizzesService.addQuestion(detail.quiz.id, body)
        : this.quizzesService.updateQuestion(detail.quiz.id, editingId, body);
    request.subscribe({
      next: () => {
        this.savingQuestion.set(false);
        this.editingQuestionId.set(null);
        this.resetQuestionForm();
        this.toast.success(editingId === null ? 'Question added.' : 'Question updated.');
        this.openDetail(detail.quiz.id);
        this.load();
      },
      error: (error: unknown) => {
        this.savingQuestion.set(false);
        this.questionErrors.set(fieldErrors(error));
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected confirmDeleteQuestion(): void {
    const detail = this.detail();
    const questionId = this.deleteQuestionId();
    if (!detail || questionId === null) return;
    this.busy.set(true);
    this.quizzesService.deleteQuestion(detail.quiz.id, questionId).subscribe({
      next: (response) => {
        this.busy.set(false);
        this.deleteQuestionId.set(null);
        this.toast.success(response.message);
        this.openDetail(detail.quiz.id);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected confirmResetAttempt(): void {
    const detail = this.detail();
    const attemptId = this.resetAttemptId();
    if (!detail || attemptId === null) return;
    this.busy.set(true);
    this.quizzesService.resetAttempt(detail.quiz.id, attemptId).subscribe({
      next: (response) => {
        this.busy.set(false);
        this.resetAttemptId.set(null);
        this.toast.success(response.message);
        this.openDetail(detail.quiz.id);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected questionStat(questionId: number): { attempts: number; correct: number } | undefined {
    return this.detail()?.question_stats.find((stat) => stat.question_id === questionId);
  }

  protected deadlineLabel(deadline: string | null): string {
    if (!deadline) return 'No deadline';
    return new Date(deadline).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  protected downloadResults(): void {
    const detail = this.detail();
    if (!detail) return;
    const safe = (value: string): string => value.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    this.quizzesService.downloadResults(
      detail.quiz.id,
      `quiz-${detail.quiz.quiz_number}-${safe(detail.quiz.subject_name)}-${safe(detail.quiz.section_name)}.csv`
    );
  }
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
