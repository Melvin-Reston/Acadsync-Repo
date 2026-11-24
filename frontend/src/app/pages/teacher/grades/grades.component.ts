// Grades: the teacher's own class records, encoded by hand and computed live.
// A blank cell is not a zero — it is left out of the component average until the
// teacher encodes it. The DepEd formula lives in core/deped.ts and mirrors the
// backend helper, so the numbers the teacher sees while typing are the numbers
// the server files. Saving persists the whole sheet for the class and term;
// filing it happens from the Submit modal — to the adviser, or straight into
// Consolidation when the teacher is both subject teacher and adviser.
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { GradesService, ScoreCell } from '../../../core/grades.service';
import { ClassesService } from '../../../core/classes.service';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import { ToastService } from '../../../core/toast.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
import { errorMessage } from '../../../core/helpers';
import {
  ClassItem,
  GradeColumn,
  GradeLearnerRow,
  GradeSheet,
  SubmissionCheck,
  TeacherSelf,
} from '../../../core/models';
import { computeLearnerGrade, descriptorFor, exSubWs } from '../../../core/deped';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';

type SexFilter = 'all' | 'Male' | 'Female';

@Component({
  selector: 'app-teacher-grades',
  imports: [FormsModule, RouterLink, DropdownComponent, IconComponent, ModalComponent],
  templateUrl: './grades.component.html',
  styleUrl: './grades.component.css',
})
export class TeacherGradesComponent {
  private readonly grades = inject(GradesService);
  private readonly classesService = inject(ClassesService);
  private readonly portal = inject(TeacherPortalService);
  private readonly toast = inject(ToastService);

  protected readonly classes = signal<ClassItem[]>([]);
  protected readonly year = inject(ViewingYearService);
  protected readonly teacher = signal<TeacherSelf | null>(null);
  protected readonly sheet = signal<GradeSheet | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly saving = signal(false);

  protected readonly selectedClassId = signal<number | ''>('');
  protected readonly quarter = signal(1);

  // Period encoding view, or the Final Grades tab (every filed period side
  // by side). The DepEd print forms print from these same rows.
  protected readonly view = signal<'period' | 'finals'>('period');
  protected readonly printTarget = signal<'class-record' | 'final-grades' | null>(null);

  // The working scores: learner id -> column id -> score (null = blank).
  // Seeded from the saved sheet on load; typing updates these, and the
  // computed grades below follow at once.
  protected readonly draft = signal<Record<number, Record<number, number | null>>>({});
  protected readonly savedDraft = signal<Record<number, Record<number, number | null>>>({});

  protected readonly search = signal('');
  protected readonly sexFilter = signal<SexFilter>('all');
  protected readonly highlightBelow = signal(false);
  protected readonly sortByRank = signal(false);

  // Weights editing (three numbers that must add up to 100).
  protected readonly weightsEditing = signal(false);
  protected readonly weightsDraft = signal({ ww: 20, pt: 50, ex: 30 });
  protected readonly weightsSaving = signal(false);

  // Examinations sub-weights (the shares of the EX component: ST1 30,
  // ST2 30, Term Exam 40). Saved together with the weights; they must add
  // up to 100. Only under a DO 015 profile.
  protected readonly subWeightsDraft = signal<Record<number, number>>({});
  protected readonly subWeightsSaving = signal(false);

  // Submit-to-adviser modal.
  protected readonly submitOpen = signal(false);
  protected readonly submitCheck = signal<SubmissionCheck | null>(null);
  protected readonly submitLoading = signal(false);
  protected readonly confirmBlanks = signal(false);
  protected readonly submitting = signal(false);

  // Remove-column confirmation modal.
  protected readonly removeColumn = signal<GradeColumn | null>(null);
  protected readonly removingColumn = signal(false);

  // The periods the active grading system offers: Terms 1–3 under DO 015,
  // Quarters 1–4 under DO 8.
  protected readonly periods = computed(() => this.sheet()?.grading.periods ?? [1, 2, 3]);

  protected readonly periodLabel = computed(() => {
    const sheet = this.sheet();
    return sheet ? `${sheet.grading.period_label} ${this.quarter()}` : '';
  });

  protected readonly components: ('WW' | 'PT' | 'EX')[] = ['WW', 'PT', 'EX'];

  protected readonly selectedClass = computed(
    () => this.classes().find((klass) => klass.id === this.selectedClassId()) ?? null,
  );

  protected readonly columnsByComponent = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return { WW: [] as GradeColumn[], PT: [] as GradeColumn[], EX: [] as GradeColumn[] };
    return {
      WW: sheet.columns.filter((column) => column.component === 'WW'),
      PT: sheet.columns.filter((column) => column.component === 'PT'),
      EX: sheet.columns.filter((column) => column.component === 'EX'),
    };
  });

  // The Examinations columns of the open period, for the sub-weights editor.
  protected readonly exColumns = computed(() => this.columnsByComponent().EX);

  protected readonly subWeightsSum = computed(() =>
    this.exColumns().reduce((sum, column) => sum + (this.subWeightsDraft()[column.id] ?? 0), 0),
  );

  protected readonly subWeightsDirty = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return false;
    return this.exColumns().some(
      (column) => (this.subWeightsDraft()[column.id] ?? 0) !== (column.sub_weight ?? 0),
    );
  });

  // The live computed grade for each learner, from the draft scores,
  // under the grading system in force for the class's academic year.
  protected readonly rows = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const draft = this.draft();
    return sheet.learners.map((learner) => {
      const scores = new Map<number, number | null>();
      for (const column of sheet.columns) {
        scores.set(column.id, draft[learner.id]?.[column.id] ?? null);
      }
      return {
        learner,
        computed: computeLearnerGrade(sheet.columns, scores, sheet.weights, sheet.grading.code),
        // The final grade, from the saved scores of every period — null
        // until every period has a complete saved record for the
        // learner. It never follows an unsaved draft: only Save scores
        // makes a typed score part of the final grade.
        final: sheet.finals.grades[learner.id] ?? null,
        // The Examinations sub-column weighted scores (WS ST1 / WS ST2 /
        // WS TE) for the DepEd class record printout.
        exSub: exSubWs(sheet.columns, scores, sheet.grading.code),
      };
    });
  });

  // The printout shows the whole roster, unfiltered, grouped Male then
  // Female with numbering restarted in each group — the DepEd form's order.
  protected readonly printGroups = computed(() => {
    const rows = this.rows();
    const groups = [
      { label: 'MALE', rows: rows.filter((row) => row.learner.sex === 'Male') },
      { label: 'FEMALE', rows: rows.filter((row) => row.learner.sex === 'Female') },
    ];
    return groups.filter((group) => group.rows.length > 0);
  });

  // The Final Grades tab: every period's saved grade side by side, with
  // the final grade, descriptor and remark.
  protected readonly finalRows = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.learners.map((learner) => {
      const periodGrades = sheet.finals.period_grades[learner.id] ?? {};
      const final = sheet.finals.grades[learner.id] ?? null;
      return {
        learner,
        periodGrades,
        final,
        descriptor: final === null ? null : descriptorFor(final, sheet.grading.code),
        remark: final === null ? '' : final >= 75 ? 'Passed' : 'Failed',
      };
    });
  });

  protected readonly finalGroups = computed(() => {
    const rows = this.finalRows();
    const groups = [
      { label: 'MALE', rows: rows.filter((row) => row.learner.sex === 'Male') },
      { label: 'FEMALE', rows: rows.filter((row) => row.learner.sex === 'Female') },
    ];
    return groups.filter((group) => group.rows.length > 0);
  });

  // Whether the Examinations block prints with the ST1/ST2/TE sub-column
  // breakdown (DO 015) or as a single block (DO 8).
  protected readonly exBreakdown = computed(() => this.sheet()?.grading.code !== 'do8_2015');

  // The share of the Examinations component each EX column carries, for the
  // Highest Possible Score row: the sub-weight when any column has one,
  // otherwise equal shares — the same rule the computation uses.
  protected readonly exShares = computed(() => {
    const sheet = this.sheet();
    const shares = new Map<number, number>();
    if (!sheet) return shares;
    const ex = sheet.columns.filter((column) => column.component === 'EX');
    if (ex.length === 0) return shares;
    const anyWeight = ex.some((column) => column.sub_weight !== null && column.sub_weight !== undefined);
    for (const column of ex) {
      shares.set(column.id, anyWeight ? column.sub_weight ?? 0 : 100 / ex.length);
    }
    return shares;
  });

  protected readonly teacherName = computed(() => {
    const teacher = this.teacher();
    if (!teacher) return '';
    return `${teacher.first_name} ${teacher.last_name}`.toUpperCase();
  });

  protected readonly filteredRows = computed(() => {
    const query = this.search().trim().toLowerCase();
    const sex = this.sexFilter();
    let rows = this.rows().filter(({ learner }) => {
      if (sex !== 'all' && learner.sex !== sex) return false;
      if (!query) return true;
      return `${learner.first_name} ${learner.last_name} ${learner.learner_id}`
        .toLowerCase()
        .includes(query);
    });
    if (this.sortByRank()) {
      rows = [...rows].sort((a, b) => {
        const qa = a.computed.qg ?? -1;
        const qb = b.computed.qg ?? -1;
        if (qb !== qa) return qb - qa;
        return b.computed.entered - a.computed.entered;
      });
    }
    return rows;
  });

  // The five summary stats, recomputed live from the draft scores.
  protected readonly stats = computed(() => {
    const rows = this.rows();
    const complete = rows.filter((row) => row.computed.complete);
    const qgs = complete.map((row) => row.computed.qg as number);
    const initials = complete.map((row) => row.computed.initial as number);
    const entered = rows.reduce((sum, row) => sum + row.computed.entered, 0);
    const cells = rows.reduce((sum, row) => sum + row.computed.cells, 0);
    return {
      mps: initials.length > 0 ? Math.round((initials.reduce((a, b) => a + b, 0) / initials.length) * 100) / 100 : null,
      passingRate:
        qgs.length > 0
          ? Math.round((qgs.filter((qg) => qg >= 75).length / qgs.length) * 100)
          : null,
      highest: qgs.length > 0 ? Math.max(...qgs) : null,
      intervention: rows
        .filter((row) => row.computed.complete && (row.computed.qg as number) < 75)
        .map((row) => `${row.learner.last_name}, ${row.learner.first_name}`),
      encodingPct: cells === 0 ? 0 : Math.round((entered / cells) * 100),
      completeCount: complete.length,
      total: rows.length,
    };
  });

  // How many cells differ from the last saved sheet, counted in one pass
  // over the draft — no stringifying the whole sheet on every check, which
  // is what the old dirty check did on every change-detection run.
  protected readonly changedCount = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return 0;
    const draft = this.draft();
    const saved = this.savedDraft();
    let count = 0;
    for (const learner of sheet.learners) {
      for (const column of sheet.columns) {
        if ((draft[learner.id]?.[column.id] ?? null) !== (saved[learner.id]?.[column.id] ?? null)) {
          count += 1;
        }
      }
    }
    return count;
  });

  protected readonly dirty = computed(() => this.changedCount() > 0);

  // The weights form holds unsaved changes when its numbers differ from
  // the sheet's saved weights (or the Examinations shares differ).
  protected readonly weightsDirty = computed(() => {
    const sheet = this.sheet();
    if (!sheet || !this.weightsEditing()) return false;
    const draft = this.weightsDraft();
    return (
      draft.ww !== sheet.weights.ww ||
      draft.pt !== sheet.weights.pt ||
      draft.ex !== sheet.weights.ex ||
      this.subWeightsDirty()
    );
  });

  // Everything on this page that would be lost by leaving: unsaved scores
  // or an unsaved weights edit. The route guard and the browser's
  // before-unload prompt both ask through this one check.
  hasUnsavedChanges(): boolean {
    return this.dirty() || this.weightsDirty();
  }

  // Asks before throwing away unsaved scores (or weights) for an in-page
  // switch — changing class or term reloads the sheet from the server.
  // Returns true when the switch may go ahead.
  private confirmDiscardIfDirty(): boolean {
    if (!this.hasUnsavedChanges()) return true;
    return window.confirm(
      'You have unsaved scores on this page. Leave without saving them?',
    );
  }

  protected readonly weightsSum = computed(
    () => this.weightsDraft().ww + this.weightsDraft().pt + this.weightsDraft().ex,
  );

  protected readonly submittedNote = computed(() => {
    const submission = this.sheet()?.submission;
    if (!submission) return '';
    return new Date(submission.submitted_at).toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  });

  // The class picker in the page head.
  protected readonly classOptions = computed<DropdownOption[]>(() =>
    this.classes().map((klass) => ({
      value: klass.id,
      label: `${klass.subject_name} · ${klass.section_name}`,
      sub: `Grade ${klass.grade_level} · AY ${klass.academic_year}`,
    })),
  );

  // The formula strip: Initial = (WW × 0.20) + (PT × 0.50) + (EX × 0.30),
  // from the weights in force for this class.
  protected readonly formulaText = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return '';
    const weight = (value: number) => (value / 100).toFixed(2);
    return `Initial = (WW × ${weight(sheet.weights.ww)}) + (PT × ${weight(sheet.weights.pt)}) + (${sheet.grading.third_short} × ${weight(sheet.weights.ex)})`;
  });

  // Learner counts per sex, for the filter chips.
  protected readonly sexCounts = computed(() => {
    const learners = this.sheet()?.learners ?? [];
    return {
      all: learners.length,
      Male: learners.filter((learner) => learner.sex === 'Male').length,
      Female: learners.filter((learner) => learner.sex === 'Female').length,
    };
  });

  // The filing button: "Move to Consolidation" when the teacher is both the
  // subject teacher and the adviser of this class, "Submit to adviser"
  // (or "Re-submit to adviser") otherwise.
  protected readonly submitLabel = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return 'Submit to adviser';
    if (sheet.direct_add) return 'Move to Consolidation';
    return sheet.submission ? 'Re-submit to adviser' : 'Submit to adviser';
  });

  constructor() {
    this.portal.me().subscribe({
      next: (response) => this.teacher.set(response.teacher),
      error: () => undefined,
    });
    effect(() => {
      if (this.year.selectedYear() || this.year.loaded()) this.loadClasses();
    });
    // Leaving the tab or closing the browser with unsaved scores: the
    // browser shows its own leave-page prompt for this event.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (this.hasUnsavedChanges()) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', beforeUnload));
    // A print section renders only for the form being printed; clear it
    // once the print dialog closes so the next print starts clean.
    window.addEventListener('afterprint', () => this.printTarget.set(null));
  }

  // ---------- Loading ----------

  // The academic year a class-list load is already in flight for. The
  // viewing-year effect fires when either the selected year or the loaded
  // flag changes, which can be the same year twice on first render —
  // loading the class list (and the sheet) twice for it is wasted work.
  private loadingClassesYear: string | null = null;

  private loadClasses(): void {
    const yearKey = this.year.selectedYear() ?? '';
    if (yearKey === this.loadingClassesYear) return;
    this.loadingClassesYear = yearKey;
    this.classesService.classes({ academic_year: this.year.selectedYear() ?? '' }).subscribe({
      next: (response) => {
        this.loadingClassesYear = null;
        this.classes.set(response.items);
        if (response.items.length === 0) {
          this.loading.set(false);
          return;
        }
        this.selectedClassId.set(response.items[0].id);
        this.loadSheet();
      },
      error: (error) => {
        this.loadingClassesYear = null;
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected loadSheet(quarter?: number): void {
    const classId = this.selectedClassId();
    if (classId === '') return;
    this.loading.set(true);
    this.grades.sheet(classId, quarter).subscribe({
      next: (sheet) => {
        this.sheet.set(sheet);
        this.quarter.set(sheet.quarter);
        this.weightsDraft.set({ ...sheet.weights });
        this.weightsEditing.set(false);
        const subWeights: Record<number, number> = {};
        for (const column of sheet.columns) {
          if (column.component === 'EX') subWeights[column.id] = column.sub_weight ?? 0;
        }
        this.subWeightsDraft.set(subWeights);
        const draft: Record<number, Record<number, number | null>> = {};
        for (const learner of sheet.learners) {
          draft[learner.id] = { ...learner.scores };
        }
        this.draft.set(draft);
        this.savedDraft.set(JSON.parse(JSON.stringify(draft)));
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected onClassSelect(classId: number | ''): void {
    if (classId === this.selectedClassId()) return;
    // The picker is bound to selectedClassId, so cancelling here leaves
    // it showing the class whose sheet is still on screen.
    if (!this.confirmDiscardIfDirty()) return;
    this.selectedClassId.set(classId);
    this.error.set('');
    this.loadSheet();
  }

  protected onQuarterChange(value: number): void {
    // Already encoding this term: nothing to do — unless the Final
    // Grades tab is showing, in which case this returns to the sheet.
    if (value === this.quarter() && this.view() === 'period') return;
    if (!this.confirmDiscardIfDirty()) return;
    this.view.set('period');
    this.quarter.set(value);
    this.error.set('');
    this.loadSheet(value);
  }

  protected onFinalsTab(): void {
    this.view.set('finals');
    this.error.set('');
  }

  // Prints one DepEd form: the print section for it renders, then the
  // browser print dialog opens. The section is print-only (hidden on
  // screen) and the app chrome never prints.
  protected printForm(target: 'class-record' | 'final-grades'): void {
    this.printTarget.set(target);
    window.setTimeout(() => window.print(), 60);
  }

  protected recalculate(): void {
    // The numbers are computed live as the teacher types; this re-reads the
    // saved sheet from the server and recomputes everything from it.
    this.loadSheet(this.quarter());
    this.toast.success('Grades recalculated from the saved scores.');
  }

  // ---------- Encoding ----------

  protected setScore(learner: GradeLearnerRow, column: GradeColumn, raw: string): void {
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > column.highest_possible)) {
      // Out of range: leave the draft alone; the input shows the last good value.
      this.draft.set({ ...this.draft() });
      return;
    }
    const next = { ...this.draft() };
    next[learner.id] = { ...(next[learner.id] ?? {}), [column.id]: value };
    this.draft.set(next);
  }

  protected save(): void {
    const sheet = this.sheet();
    const classId = this.selectedClassId();
    if (!sheet || classId === '') return;
    const saved = this.savedDraft();
    const draft = this.draft();
    const cells: ScoreCell[] = [];
    for (const learner of sheet.learners) {
      for (const column of sheet.columns) {
        const value = draft[learner.id]?.[column.id] ?? null;
        const before = saved[learner.id]?.[column.id] ?? null;
        if (value !== before) {
          cells.push({ column_id: column.id, learner_id: learner.id, score: value });
        }
      }
    }
    if (cells.length === 0) {
      this.toast.success('Nothing new to save.');
      return;
    }
    this.saving.set(true);
    this.grades.saveScores(classId, this.quarter(), cells).subscribe({
      next: (response) => {
        this.saving.set(false);
        if (response.submission_cleared) {
          this.toast.success(`Scores saved. The earlier submission was cleared — file the ${this.periodLabel().toLowerCase()} again when ready.`);
        } else {
          this.toast.success('Scores saved.');
        }
        this.loadSheet(this.quarter());
      },
      error: (error) => {
        this.saving.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected discardChanges(): void {
    this.draft.set(JSON.parse(JSON.stringify(this.savedDraft())));
    this.toast.success('Changes discarded — back to the last saved scores.');
  }

  protected exportCsv(): void {
    const klass = this.selectedClass();
    const classId = this.selectedClassId();
    if (!klass || classId === '') return;
    const safe = (value: string) => value.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
    const periodShort = this.sheet()?.grading.period_short.toLowerCase() ?? 'q';
    this.grades.exportCsv(
      classId,
      this.quarter(),
      `grades-${safe(klass.subject_name)}-${safe(klass.section_name)}-${periodShort}${this.quarter()}.csv`,
    );
  }

  // ---------- Columns ----------

  protected addColumn(component: 'WW' | 'PT' | 'EX'): void {
    const classId = this.selectedClassId();
    if (classId === '') return;
    this.grades.addColumn(classId, this.quarter(), component).subscribe({
      next: (response) => {
        this.toast.success(`Added ${response.column.name}.`);
        this.loadSheet(this.quarter());
      },
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected updateColumnMax(column: GradeColumn, raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    if (value === column.highest_possible) return;
    const classId = this.selectedClassId();
    if (classId === '') return;
    this.grades.updateColumn(classId, column.id, value).subscribe({
      next: () => {
        this.toast.success(`${column.name} highest possible score is now ${value}.`);
        this.loadSheet(this.quarter());
      },
      error: (error) => {
        this.error.set(errorMessage(error));
        this.loadSheet(this.quarter());
      },
    });
  }

  protected askRemoveColumn(column: GradeColumn): void {
    this.removeColumn.set(column);
  }

  protected confirmRemoveColumn(): void {
    const column = this.removeColumn();
    const classId = this.selectedClassId();
    if (!column || classId === '') return;
    this.removingColumn.set(true);
    this.grades.deleteColumn(classId, column.id).subscribe({
      next: () => {
        this.removingColumn.set(false);
        this.removeColumn.set(null);
        this.toast.success(`Removed ${column.name} and its scores.`);
        this.loadSheet(this.quarter());
      },
      error: (error) => {
        this.removingColumn.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  // ---------- Weights ----------

  protected saveWeights(): void {
    const classId = this.selectedClassId();
    if (classId === '') return;
    if (this.weightsSum() !== 100) return;
    if (this.subWeightsDirty() && this.subWeightsSum() !== 100) return;
    this.weightsSaving.set(true);
    this.grades.updateWeights(classId, this.weightsDraft()).subscribe({
      next: () => {
        // The Examinations shares save with the weights, when they changed.
        if (this.subWeightsDirty() && this.subWeightsSum() === 100) {
          this.saveSubWeights(true);
          return;
        }
        this.weightsSaving.set(false);
        this.weightsEditing.set(false);
        this.toast.success('Weights saved.');
        this.loadSheet(this.quarter());
      },
      error: (error) => {
        this.weightsSaving.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected setSubWeight(column: GradeColumn, raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    this.subWeightsDraft.set({ ...this.subWeightsDraft(), [column.id]: value });
  }

  // Saves the Examinations shares for the open period. Called from
  // saveWeights when they changed, or on their own from the weights form.
  protected saveSubWeights(fromWeightsSave = false): void {
    const classId = this.selectedClassId();
    if (classId === '') return;
    if (this.subWeightsSum() !== 100) return;
    this.subWeightsSaving.set(true);
    const subWeights = this.exColumns().map((column) => ({
      column_id: column.id,
      sub_weight: this.subWeightsDraft()[column.id] ?? 0,
    }));
    this.grades.updateSubWeights(classId, this.quarter(), subWeights).subscribe({
      next: () => {
        this.subWeightsSaving.set(false);
        if (fromWeightsSave) {
          this.weightsSaving.set(false);
          this.weightsEditing.set(false);
          this.toast.success('Weights saved.');
        } else {
          this.toast.success('Examinations sub-weights saved.');
        }
        this.loadSheet(this.quarter());
      },
      error: (error) => {
        this.subWeightsSaving.set(false);
        if (fromWeightsSave) this.weightsSaving.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected cancelWeights(): void {
    const sheet = this.sheet();
    if (sheet) {
      this.weightsDraft.set({ ...sheet.weights });
      const subWeights: Record<number, number> = {};
      for (const column of sheet.columns) {
        if (column.component === 'EX') subWeights[column.id] = column.sub_weight ?? 0;
      }
      this.subWeightsDraft.set(subWeights);
    }
    this.weightsEditing.set(false);
  }

  // ---------- Submit to the adviser ----------

  protected openSubmit(): void {
    const classId = this.selectedClassId();
    if (classId === '') return;
    this.submitLoading.set(true);
    this.grades.submissionCheck(classId, this.quarter()).subscribe({
      next: (check) => {
        this.submitCheck.set(check);
        this.confirmBlanks.set(false);
        this.submitLoading.set(false);
        this.submitOpen.set(true);
      },
      error: (error) => {
        this.submitLoading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected submit(): void {
    const classId = this.selectedClassId();
    const check = this.submitCheck();
    if (classId === '' || !check) return;
    if (check.complete_learners < check.total_learners && !this.confirmBlanks()) return;
    this.submitting.set(true);
    this.grades.submit(classId, this.quarter(), this.confirmBlanks()).subscribe({
      next: (response) => {
        this.submitting.set(false);
        this.submitOpen.set(false);
        this.toast.success(response.message);
        this.loadSheet(this.quarter());
      },
      error: (error) => {
        this.submitting.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  // ---------- Formatting ----------

  protected componentLabel(component: 'WW' | 'PT' | 'EX'): string {
    if (component === 'WW') return 'Written Works';
    if (component === 'PT') return 'Performance Tasks';
    return this.sheet()?.grading.third_label ?? 'Examinations';
  }

  protected fmt(value: number | null): string {
    if (value === null || value === undefined) return '—';
    return String(Math.round(value * 100) / 100);
  }

  // Print forms leave a cell blank when there is no value — a blank is not
  // a zero on the working record.
  protected pfmt(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    return String(Math.round(value * 100) / 100);
  }

  protected learnerName(learner: GradeLearnerRow): string {
    return `${learner.last_name}, ${learner.first_name}`;
  }

  protected upperName(learner: GradeLearnerRow): string {
    return `${learner.last_name}, ${learner.first_name}`.toUpperCase();
  }

  // Short header for an Examinations column on the class record: ST1, ST2,
  // TE for the default columns, the column name for a teacher-added one.
  protected exShortLabel(column: GradeColumn): string {
    if (column.label === 'Summative Test 1') return 'ST1';
    if (column.label === 'Summative Test 2') return 'ST2';
    if (column.label === 'Term Exam') return 'TE';
    return column.name;
  }

  // The Highest Possible Score row: the component total is the sum of its
  // columns' highest possible scores; PS is 100 and WS is the weight.
  protected hpsTotal(component: 'WW' | 'PT' | 'EX'): number {
    const sheet = this.sheet();
    if (!sheet) return 0;
    return sheet.columns
      .filter((column) => column.component === component)
      .reduce((sum, column) => sum + column.highest_possible, 0);
  }

  // A component total on the printout: blank until at least one score is
  // encoded in the component.
  protected printTotal(row: { computed: { components: Record<'WW' | 'PT' | 'EX', { total: number; entered: number }> } }, component: 'WW' | 'PT' | 'EX'): number | null {
    const part = row.computed.components[component];
    return part.entered > 0 ? part.total : null;
  }

  // How many columns the class record print table has, for the group rows.
  protected readonly printColspan = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return 4;
    const groups = this.columnsByComponent();
    let total = 1 + 3; // learner name + Initial + Term Grade + Descriptor
    for (const component of ['WW', 'PT'] as const) {
      if (groups[component].length > 0) total += groups[component].length + 3;
    }
    // Examinations: the sub-columns plus PS and WS (2, not 3), plus the
    // WS sub-columns under DO 015.
    if (groups.EX.length > 0) total += groups.EX.length + 2;
    if (this.exBreakdown() && groups.EX.length > 0) total += groups.EX.length;
    return total;
  });

  // The period heading in the class record print header, e.g. FIRST TERM,
  // SECOND TERM, FIRST QUARTER — the ordinal word for the open period
  // plus the grading system's period label, never hardcoded.
  protected readonly periodOrdinalLabel = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return '';
    const ordinals: Record<number, string> = { 1: 'FIRST', 2: 'SECOND', 3: 'THIRD', 4: 'FOURTH' };
    const word = ordinals[this.quarter()] ?? String(this.quarter());
    return `${word} ${sheet.grading.period_label.toUpperCase()}`;
  });

  // Colspans for the class record print header, generalised to the
  // sheet's real column counts. The Grade Level / Section block spans
  // the WW columns; the Teacher and Subject blocks together span the
  // rest (PT + EX + the three grade columns), Teacher wider than
  // Subject, roughly PT + half the EX block. Every row sums to
  // printColspan().
  protected readonly printHeaderSpans = computed(() => {
    const groups = this.columnsByComponent();
    const ww = groups.WW.length > 0 ? groups.WW.length + 3 : 0;
    const pt = groups.PT.length > 0 ? groups.PT.length + 3 : 0;
    const ex = groups.EX.length > 0
      ? groups.EX.length + 2 + (this.exBreakdown() ? groups.EX.length : 0)
      : 0;
    const total = this.printColspan();
    const gradeSpan = ww > 0 ? ww : pt > 0 ? pt : ex > 0 ? ex : 1;
    const rest = total - 1 - gradeSpan;
    let teacherSpan = pt + Math.ceil(ex / 2);
    if (rest >= 4) teacherSpan = Math.min(Math.max(teacherSpan, 2), rest - 2);
    else teacherSpan = Math.max(1, rest - 1);
    const subjectSpan = rest - teacherSpan;
    const gradeLabel = Math.max(1, Math.floor(gradeSpan / 3));
    const teacherLabel = Math.max(1, Math.floor(teacherSpan / 4));
    const subjectLabel = Math.max(1, Math.floor(subjectSpan / 3));
    return {
      ww, pt, ex, total,
      gradeLabel, gradeValue: gradeSpan - gradeLabel,
      teacherLabel, teacherValue: teacherSpan - teacherLabel,
      subjectLabel, subjectValue: subjectSpan - subjectLabel,
    };
  });

  // One width per print column, so the header colspans stay aligned with
  // the data columns below under table-layout: fixed (the header's first
  // row is a single full-width bar and carries no per-column widths).
  protected readonly printColWidths = computed(() => {
    const spans = this.printHeaderSpans();
    const widths: number[] = [140];
    for (let i = 0; i < spans.ww + spans.pt + spans.ex; i++) widths.push(30);
    widths.push(50, 50, 62);
    return widths;
  });

  protected resetFilters(): void {
    this.search.set('');
    this.sexFilter.set('all');
    this.highlightBelow.set(false);
    this.sortByRank.set(false);
  }
}
