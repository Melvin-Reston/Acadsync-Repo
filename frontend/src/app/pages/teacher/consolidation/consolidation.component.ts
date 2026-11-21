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
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConsolidationService } from '../../../core/consolidation.service';
import { ToastService } from '../../../core/toast.service';
import { errorMessage } from '../../../core/helpers';
import { ConsolidationFinals, ConsolidationView } from '../../../core/models';
import { IconComponent } from '../../../shared/icon.component';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';

type Tab = 'all' | 'honors' | 'at_risk';

@Component({
  selector: 'app-teacher-consolidation',
  imports: [FormsModule, RouterLink, IconComponent, DropdownComponent],
  templateUrl: './consolidation.component.html',
  styleUrl: './consolidation.component.css',
})
export class TeacherConsolidationComponent {
  private readonly consolidation = inject(ConsolidationService);
  private readonly toast = inject(ToastService);

  protected readonly view = signal<ConsolidationView | null>(null);
  protected readonly finals = signal<ConsolidationFinals | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly refreshing = signal(false);

  protected readonly quarter = signal(1);
  protected readonly search = signal('');
  protected readonly tab = signal<Tab>('all');
  protected readonly reminding = signal<number | null>(null);

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
    this.load();
  }

  protected load(quarter?: number): void {
    this.loading.set(true);
    // No period on the first load: the API opens the highest period that
    // already has data, else the first period, and the page follows it.
    this.consolidation.view(quarter).subscribe({
      next: (view) => {
        this.view.set(view);
        this.quarter.set(view.quarter);
        this.loading.set(false);
        this.loadFinals();
      },
      error: (error) => {
        this.loading.set(false);
        this.handleLoadError(error);
      },
    });
  }

  // The final grades across the year's periods. Loaded alongside the period
  // view; a teacher with no advisory assignment never gets here.
  private loadFinals(): void {
    this.consolidation.finals().subscribe({
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
    this.consolidation.view(this.quarter()).subscribe({
      next: (view) => {
        this.view.set(view);
        this.refreshing.set(false);
        this.toast.success('Consolidation refreshed.');
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

  protected exportCsv(): void {
    const view = this.view();
    if (!view) return;
    const safe = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    const section = view.section ? safe(view.section) : 'section';
    const periodShort = view.grading.period_short.toLowerCase();
    this.consolidation.exportCsv(this.quarter(), `consolidation-g${view.grade}-${section}-${periodShort}${this.quarter()}.csv`);
  }

  protected exportFinalsCsv(): void {
    const view = this.view();
    if (!view) return;
    const safe = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    const section = view.section ? safe(view.section) : 'section';
    this.consolidation.exportFinalsCsv(`consolidation-final-g${view.grade}-${section}.csv`);
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
