// The page a learner opens from a quiz link (Batch 9). No sign-in: the
// learner enters their Learner ID, confirms their name, answers, and
// submits. The answer key never reaches this page — checking happens on
// the server — and the result shows the score only, never which answers
// were right, so the key cannot be passed around while the quiz is open.
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { errorMessage } from '../../core/helpers';
import { PublicQuiz, QuizLookup, QuizQuestion, QuizSubmitResult } from '../../core/models';
import { QuizzesService } from '../../core/quizzes.service';

type Step = 'loading' | 'identify' | 'confirm' | 'questions' | 'result' | 'blocked';

@Component({
  selector: 'app-quiz-take',
  imports: [FormsModule],
  templateUrl: './quiz-take.component.html',
  styleUrl: './quiz-take.component.css',
})
export class QuizTakeComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly quizzesService = inject(QuizzesService);

  protected readonly step = signal<Step>('loading');
  protected readonly loadError = signal('');
  protected readonly quiz = signal<PublicQuiz | null>(null);
  protected readonly code = signal('');

  protected readonly learnerIdInput = signal('');
  protected readonly lookupError = signal('');
  protected readonly lookupBusy = signal(false);
  protected readonly lookup = signal<QuizLookup | null>(null);

  protected readonly answers = signal<Record<number, number | null>>({});
  protected readonly submitError = signal('');
  protected readonly submitting = signal(false);
  protected readonly result = signal<QuizSubmitResult | null>(null);

  protected readonly answeredCount = computed(() => Object.values(this.answers()).filter((value) => value !== null).length);
  protected readonly totalQuestions = computed(() => this.quiz()?.questions.length ?? 0);
  protected readonly blockedReason = computed(() => {
    const data = this.quiz();
    if (!data) return '';
    if (data.quiz.status === 'draft') return 'This quiz is not open yet. Ask your teacher for the link when it is published.';
    if (data.quiz.deadline && new Date(data.quiz.deadline) <= new Date()) return 'The deadline for this quiz has passed.';
    return 'This quiz is closed. Ask your teacher if it will open again.';
  });

  constructor() {
    const code = this.route.snapshot.paramMap.get('code') ?? '';
    this.code.set(code);
    this.quizzesService.publicQuiz(code).subscribe({
      next: (data) => {
        this.quiz.set(data);
        this.step.set(data.quiz.open ? 'identify' : 'blocked');
      },
      error: (error: unknown) => {
        this.loadError.set(errorMessage(error));
        this.step.set('blocked');
      },
    });
  }

  protected findLearner(): void {
    const learnerId = this.learnerIdInput().trim();
    if (!learnerId) {
      this.lookupError.set('Enter your Learner ID.');
      return;
    }
    this.lookupBusy.set(true);
    this.lookupError.set('');
    this.quizzesService.lookup(this.code(), learnerId).subscribe({
      next: (data) => {
        this.lookupBusy.set(false);
        this.lookup.set(data);
        if (data.already_submitted && data.attempt) {
          this.result.set({
            score: data.attempt.score,
            total_points: data.attempt.total_points,
            correct_count: 0,
            total_questions: 0,
            submitted_at: data.attempt.submitted_at,
            learner_name: `${data.learner.first_name} ${data.learner.last_name}`,
            message: `You already submitted this quiz and scored ${data.attempt.score} out of ${data.attempt.total_points}.`,
          });
          this.step.set('result');
          return;
        }
        if (!data.open) {
          this.step.set('blocked');
          return;
        }
        this.step.set('confirm');
      },
      error: (error: unknown) => {
        this.lookupBusy.set(false);
        this.lookupError.set(errorMessage(error));
      },
    });
  }

  protected startQuiz(): void {
    const data = this.quiz();
    if (!data) return;
    const initial: Record<number, number | null> = {};
    for (const question of data.questions) initial[question.id] = null;
    this.answers.set(initial);
    this.step.set('questions');
  }

  protected notMe(): void {
    this.lookup.set(null);
    this.learnerIdInput.set('');
    this.step.set('identify');
  }

  protected choose(questionId: number, index: number): void {
    this.answers.update((current) => ({ ...current, [questionId]: index }));
  }

  protected submit(): void {
    const data = this.quiz();
    const lookup = this.lookup();
    if (!data || !lookup) return;
    const answers = data.questions.map((question: QuizQuestion) => ({
      question_id: question.id,
      selected_index: this.answers()[question.id] ?? null,
    }));
    this.submitting.set(true);
    this.submitError.set('');
    this.quizzesService.submit(this.code(), lookup.learner.learner_id, answers).subscribe({
      next: (result: QuizSubmitResult) => {
        this.submitting.set(false);
        this.result.set(result);
        this.step.set('result');
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.submitError.set(errorMessage(error));
      },
    });
  }

  protected deadlineLabel(deadline: string | null): string {
    if (!deadline) return '';
    return new Date(deadline).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
