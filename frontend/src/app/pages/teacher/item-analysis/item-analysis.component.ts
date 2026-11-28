// Test Item Analysis (Batch 12): one tab in Quizzes & Exams, for the
// paper exams only. The teacher picks an exam; the analysis is read
// from the API, which computes it from the saved checked sheets, so
// checking or re-checking a sheet in the Exams tab updates this tab
// by itself — there is nothing to generate or upload. A printout
// follows the teacher's Test Item Analysis sheet: difficulty and
// discrimination with the sheet's bands, distractor analysis, the
// summary counts, and the signature lines. The print header comes
// from the teacher's own record and school, never from a sample.
import { Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ExamsService } from '../../../core/exams.service';
import { errorMessage } from '../../../core/helpers';
import { Exam, ItemAnalysis, ItemAnalysisItem } from '../../../core/models';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';

// Chart rows run hardest/poorest first, as on the sample sheet, with
// each bar's width as a percentage of the chart's largest count.
function chartRows(rows: { label: string; count: number }[]): { label: string; count: number; pct: number }[] {
  const max = Math.max(0, ...rows.map((row) => row.count));
  return [...rows].reverse().map((row) => ({ ...row, pct: max === 0 ? 0 : Math.round((row.count / max) * 100) }));
}

const DIFFICULTY_ORDER = ['Very Easy', 'Easy', 'Moderately Difficult', 'Difficult', 'Very Difficult'];
const DISCRIMINATION_ORDER = [
  'Very Good Item',
  'Good Item; Very Usable',
  'Fair Quality; Usable Item',
  'Potentially Poor Item',
  'Potentially Very Poor',
];

@Component({
  selector: 'app-teacher-item-analysis',
  imports: [FormsModule, RouterLink, DropdownComponent, IconComponent],
  templateUrl: './item-analysis.component.html',
  styleUrl: './item-analysis.component.css',
})
export class TeacherItemAnalysisComponent implements OnDestroy {
  private readonly examsService = inject(ExamsService);
  private readonly teacherPortal = inject(TeacherPortalService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly year = inject(ViewingYearService);
  private readonly querySubscription: Subscription;

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly exams = signal<Exam[]>([]);
  protected readonly selectedExamId = signal<number | null>(null);
  protected readonly analysis = signal<ItemAnalysis | null>(null);
  protected readonly analysisLoading = signal(false);
  protected readonly analysisError = signal('');
  // The school seal for the print header, loaded from the sealed
  // endpoint when the analysis says the school has one, and revoked
  // when the page is left, so the blob never leaks. When the school
  // has no seal, the header prints with no logo at all.
  protected readonly schoolSealUrl = signal<string | null>(null);
  // The two long tables sit behind their own tabs so neither view
  // scrolls through both. The printout always shows the whole
  // analysis, whichever tab is open on screen.
  protected readonly view = signal<'items' | 'distractors'>('items');

  protected readonly examOptions = computed<DropdownOption[]>(() =>
    this.exams().map((exam) => ({
      value: exam.id,
      label: `Exam ${exam.exam_number} · ${exam.title}`,
      sub: `${exam.subject_name} · Grade ${exam.grade_level} ${exam.section_name} · ${exam.scan_count} checked`,
    }))
  );

  protected readonly selectedExam = computed(() =>
    this.exams().find((exam) => exam.id === this.selectedExamId()) ?? null
  );

  protected readonly difficultyRows = computed(() => {
    const counts = this.analysis()?.summary.difficulty_counts;
    return DIFFICULTY_ORDER.map((label) => ({ label, count: counts?.[label] ?? 0 }));
  });

  protected readonly discriminationRows = computed(() => {
    const counts = this.analysis()?.summary.discrimination_counts;
    return DISCRIMINATION_ORDER.map((label) => ({ label, count: counts?.[label] ?? 0 }));
  });

  // Bar-chart rows, in the sample sheet's order (hardest and poorest
  // first), with each bar sized against the chart's largest count.
  protected readonly difficultyChartRows = computed(() => chartRows(this.difficultyRows()));
  protected readonly discriminationChartRows = computed(() => chartRows(this.discriminationRows()));

  // The marker beside an item's Difficulty and Discrimination values:
  // 'warn' when the lower group beat the upper group on the item,
  // 'most' for a most-learned item, 'least' for a least-learned one.
  // The warning wins over a learned marker. When every item shares
  // one difficulty, most and least are the same list, so no learned
  // marker shows at all.
  protected itemMark(item: ItemAnalysisItem): 'most' | 'least' | 'warn' | null {
    if (item.negative) return 'warn';
    const report = this.analysis();
    if (!report) return null;
    const difficulties = report.items
      .map((row) => row.difficulty)
      .filter((value): value is number => value !== null);
    if (difficulties.length === 0) return null;
    if (Math.max(...difficulties) === Math.min(...difficulties)) return null;
    if (report.summary.most_learned.includes(item.position)) return 'most';
    if (report.summary.least_learned.includes(item.position)) return 'least';
    return null;
  }

  constructor() {
    this.querySubscription = this.route.queryParamMap.subscribe((params) => {
      const requested = Number(params.get('exam'));
      if (Number.isInteger(requested) && requested > 0 && requested !== this.selectedExamId()) {
        this.selectedExamId.set(requested);
        this.loadAnalysis(requested);
      }
    });
    effect(() => {
      const selected = this.year.selectedYear();
      if (selected || this.year.loaded()) this.loadExams();
    });
  }

  ngOnDestroy(): void {
    this.querySubscription.unsubscribe();
    this.revokeSchoolSeal();
  }

  private revokeSchoolSeal(): void {
    const url = this.schoolSealUrl();
    if (url) URL.revokeObjectURL(url);
    this.schoolSealUrl.set(null);
  }

  private loadSchoolSeal(hasSeal: boolean): void {
    this.revokeSchoolSeal();
    if (!hasSeal) return;
    this.teacherPortal.schoolSealImage().subscribe({
      next: (blob) => this.schoolSealUrl.set(URL.createObjectURL(blob)),
      // The forms still print without the seal if the image cannot be
      // fetched; the header simply centres on its own.
      error: () => this.schoolSealUrl.set(null),
    });
  }

  protected loadExams(): void {
    const selectedYear = this.year.selectedYear();
    this.loading.set(true);
    this.loadError.set('');
    this.examsService.list({ academic_year: selectedYear ?? '' }).subscribe({
      next: (response) => {
        this.exams.set(response.items);
        this.loading.set(false);
        const requested = Number(this.route.snapshot.queryParamMap.get('exam'));
        if (Number.isInteger(requested) && requested > 0) {
          if (response.items.some((exam) => exam.id === requested)) {
            this.selectedExamId.set(requested);
            this.loadAnalysis(requested);
            return;
          }
        }
        const firstChecked = response.items.find((exam) => exam.scan_count > 0) ?? response.items[0] ?? null;
        if (firstChecked) {
          this.selectedExamId.set(firstChecked.id);
          this.loadAnalysis(firstChecked.id);
        } else {
          this.analysis.set(null);
        }
      },
      error: (error: unknown) => {
        this.loadError.set(errorMessage(error));
        this.loading.set(false);
      },
    });
  }

  protected onExamChange(value: string | number | null): void {
    const id = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(id) || id <= 0 || id === this.selectedExamId()) return;
    this.selectedExamId.set(id);
    void this.router.navigate(['/teacher/assessments'], {
      queryParams: { tab: 'item-analysis', exam: id },
    });
    this.loadAnalysis(id);
  }

  protected loadAnalysis(id: number): void {
    this.analysisLoading.set(true);
    this.analysisError.set('');
    this.examsService.itemAnalysis(id).subscribe({
      next: (response) => {
        this.analysis.set(response);
        this.loadSchoolSeal(response.header.has_school_seal);
        this.analysisLoading.set(false);
      },
      error: (error: unknown) => {
        this.analysisError.set(errorMessage(error));
        this.analysisLoading.set(false);
      },
    });
  }

  protected refresh(): void {
    const id = this.selectedExamId();
    if (id) this.loadAnalysis(id);
    else this.loadExams();
  }

  protected selectView(next: 'items' | 'distractors'): void {
    this.view.set(next);
  }

  protected print(): void {
    window.setTimeout(() => window.print(), 60);
  }

  protected fmt(value: number | null): string {
    return value === null || value === undefined ? '—' : value.toFixed(2);
  }

  protected fmtSigned(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
  }

  protected periodWord(value: number): string {
    return ['First', 'Second', 'Third', 'Fourth'][value - 1] ?? String(value);
  }

  protected joinPositions(positions: number[]): string {
    return positions.length === 0 ? 'None' : positions.map((position) => `#${position}`).join(', ');
  }
}
