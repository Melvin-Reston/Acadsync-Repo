// Report Card (DepEd School Form 9): one card per learner in the teacher's
// advisory section. The card is filled from the consolidated grades and the
// attendance records — the page displays what the API returns and never
// recomputes a grade. The teacher's comment per learner per period is the
// only thing typed on the card, and the only thing saved from this page.
// The card itself is strictly black and white, on plain white paper, in any
// mode; the controls around it follow the warm paper system.
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ReportCardService } from '../../../core/report-card.service';
import { ToastService } from '../../../core/toast.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
import { errorMessage } from '../../../core/helpers';
import { ReportCardLearner, ReportCardView } from '../../../core/models';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';

type Scope = 'single' | 'all';
type CardView = 'front' | 'back' | 'both';

@Component({
  selector: 'app-teacher-report-card',
  imports: [FormsModule, RouterLink, IconComponent, DropdownComponent],
  templateUrl: './report-card.component.html',
  styleUrl: './report-card.component.css',
})
export class TeacherReportCardComponent {
  private readonly reportCard = inject(ReportCardService);
  protected readonly year = inject(ViewingYearService);
  private readonly toast = inject(ToastService);

  protected readonly view = signal<ReportCardView | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  // The academic year a load is already in flight for: the viewing-year
  // effect can fire twice for the same year on first render, and loading
  // the whole advisory section twice is wasted work. The guard clears
  // when the load settles.
  private loadingYear: string | null = null;

  protected readonly scope = signal<Scope>('single');
  protected readonly selectedLearnerId = signal<string>('');
  protected readonly cardView = signal<CardView>('both');

  protected readonly scopeOptions: DropdownOption[] = [
    { value: 'single', label: 'Single student card' },
    { value: 'all', label: 'All students in advisory' },
  ];

  protected readonly learnerOptions = computed<DropdownOption[]>(() =>
    (this.view()?.learners ?? []).map((learner) => ({
      value: learner.learner_id,
      label: this.learnerName(learner),
      sub: learner.learner_id,
      initials: this.learnerName(learner)
        .split(/[\s,]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase(),
    })),
  );

  // The comment drafts, one textarea per learner per period, started from
  // what the API returned. Saving writes one comment at a time.
  protected readonly drafts = signal<Record<string, Record<number, string>>>({});
  protected readonly saving = signal<string>('');

  // The cards on screen (and on paper): the chosen learner, or the whole
  // advisory section in roster order.
  protected readonly cardsToShow = computed(() => {
    const view = this.view();
    if (!view) return [];
    if (this.scope() === 'all') return view.learners;
    const selected = view.learners.find((learner) => learner.learner_id === this.selectedLearnerId());
    return selected ? [selected] : view.learners.slice(0, 1);
  });

  protected readonly showFront = computed(() => this.cardView() !== 'back');
  protected readonly showBack = computed(() => this.cardView() !== 'front');

  protected readonly periodLabels = computed(() => {
    const view = this.view();
    if (!view) return [];
    return view.grading.periods.map((period) => `${view.grading.period_label} ${period}`);
  });

  constructor() {
    effect(() => {
      if (this.year.selectedYear() || this.year.loaded()) {
        // A new year has its own roster: start from its first learner.
        this.selectedLearnerId.set('');
        this.load();
      }
    });
  }

  protected load(): void {
    const yearKey = this.year.selectedYear() ?? '';
    if (yearKey === this.loadingYear) return;
    this.loadingYear = yearKey;
    this.loading.set(true);
    this.reportCard.view(this.year.selectedYear() ?? undefined).subscribe({
      next: (view) => {
        this.loadingYear = null;
        this.view.set(view);
        if (view.learners.length > 0 && !this.selectedLearnerId()) {
          this.selectedLearnerId.set(view.learners[0].learner_id);
        }
        const drafts: Record<string, Record<number, string>> = {};
        for (const learner of view.learners) {
          drafts[learner.learner_id] = {};
          for (const period of view.grading.periods) {
            drafts[learner.learner_id][period] = learner.comments[String(period)] ?? '';
          }
        }
        this.drafts.set(drafts);
        this.loading.set(false);
      },
      error: (error) => {
        this.loadingYear = null;
        this.loading.set(false);
        this.handleLoadError(error);
      },
    });
  }

  // A teacher with no advisory assignment gets the empty state, not an error:
  // the API refuses them with NO_ADVISORY, and the page tells them to set the
  // assignment on the Dashboard.
  private handleLoadError(error: unknown): void {
    if ((error as { error?: { code?: string } })?.error?.code === 'NO_ADVISORY') {
      this.view.set({
        has_advisory: false,
        adviser: { grade: 0, section: '', name: '' },
        school_name: '',
        school_head_name: '',
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
        descriptors: [],
        months: [],
        subjects: [],
        learners: [],
      });
      this.error.set('');
      return;
    }
    this.error.set(errorMessage(error));
  }

  protected learnerName(learner: ReportCardLearner): string {
    return `${learner.last_name}, ${learner.first_name}`;
  }

  protected learnerDisplayName(learner: ReportCardLearner): string {
    return `${learner.first_name} ${learner.last_name}`;
  }

  protected fmt(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return String(value);
  }

  protected periodShort(period: number): string {
    const view = this.view();
    if (!view) return String(period);
    return `${view.grading.period_short}${period}`;
  }

  // The months a period covers, for the comment labels: Terms 1–3 are
  // Jun–Sep, Oct–Jan and Feb–Apr; Quarters 1–4 are Jun–Aug, Sep–Nov,
  // Dec–Feb and Mar–Apr.
  protected periodMonths(period: number): string {
    const view = this.view();
    if (!view) return '';
    const months = view.months;
    const spans =
      view.grading.periods.length === 4
        ? [[0, 2], [3, 5], [6, 8], [9, 10]]
        : [[0, 3], [4, 7], [8, 10]];
    const span = spans[period - 1];
    if (!span || !months[span[0]] || !months[span[1]]) return '';
    return `${months[span[0]].label} – ${months[span[1]].label}`;
  }

  protected draft(learnerId: string, period: number): string {
    return this.drafts()[learnerId]?.[period] ?? '';
  }

  // The saved comment, which is what the card prints.
  protected savedComment(learner: ReportCardLearner, period: number): string {
    return learner.comments[String(period)] ?? '';
  }

  protected setDraft(learnerId: string, period: number, value: string): void {
    this.drafts.update((drafts) => ({
      ...drafts,
      [learnerId]: { ...(drafts[learnerId] ?? {}), [period]: value },
    }));
  }

  protected commentChanged(learner: ReportCardLearner, period: number): boolean {
    return this.draft(learner.learner_id, period) !== (learner.comments[String(period)] ?? '');
  }

  protected saveComment(learner: ReportCardLearner, period: number): void {
    const key = `${learner.learner_id}:${period}`;
    this.saving.set(key);
    const text = this.draft(learner.learner_id, period);
    this.reportCard.saveComment(learner.learner_id, period, text, this.year.selectedYear() ?? undefined).subscribe({
      next: (response) => {
        this.saving.set('');
        // The saved comment is what the card prints from here on.
        this.view.update((view) => {
          if (!view) return view;
          return {
            ...view,
            learners: view.learners.map((row) => {
              if (row.learner_id !== learner.learner_id) return row;
              const comments = { ...row.comments };
              if (response.comment === null) delete comments[String(period)];
              else comments[String(period)] = response.comment;
              return { ...row, comments };
            }),
          };
        });
        this.toast.success(response.message);
      },
      error: (error) => {
        this.saving.set('');
        this.error.set(errorMessage(error));
      },
    });
  }

  protected print(): void {
    window.print();
  }
}
