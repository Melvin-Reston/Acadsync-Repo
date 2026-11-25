// Lesson plans (Batch 11): the teacher's ILAW lesson plans. The list
// shows one year's plans; the editor writes every section of the DepEd
// template; the print view shows the plan exactly as it prints, in
// black and white. The template version only: the teacher writes the
// content, and the Declaration of AI Use is part of every saved plan.
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClassesService } from '../../../core/classes.service';
import { errorMessage, fieldErrors, todayIso } from '../../../core/helpers';
import {
  ClassItem,
  FieldErrors,
  LessonPlan,
  LessonPlanDetail,
  LessonPlanForm,
} from '../../../core/models';
import { LessonPlansService } from '../../../core/lesson-plans.service';
import { TeacherAuthService } from '../../../core/teacher-auth.service';
import { ToastService } from '../../../core/toast.service';
import { ViewingYearService } from '../../../core/viewing-year.service';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';
import { LessonPlanPrintComponent } from './lesson-plan-print.component';

type EditorField = { key: keyof LessonPlanForm; label: string; rows: number; hint?: string };
type EditorSection = { title: string; fields: EditorField[] };

const FIELD_SECTIONS: EditorSection[] = [
  {
    title: 'Intentions',
    fields: [
      { key: 'competency', label: 'Learning Competency', rows: 4 },
      { key: 'objective_knowledge', label: 'Learning Objective — Knowledge', rows: 3 },
      { key: 'objective_skill', label: 'Learning Objective — Skill', rows: 3 },
      { key: 'objective_attitude', label: 'Learning Objective — Attitude', rows: 3 },
      { key: 'objective_values', label: 'Learning Objective — Values', rows: 3 },
      { key: 'learner_context', label: 'Learner Context', rows: 4 },
    ],
  },
  {
    title: 'Learning Experiences',
    fields: [
      { key: 'pre_lesson', label: 'Pre-lesson', rows: 6 },
      { key: 'flow', label: 'Flow', rows: 10 },
      { key: 'individual_activity', label: 'Individual Activity', rows: 6 },
      { key: 'individual_answers', label: 'Individual Activity — Answer Key', rows: 4 },
      { key: 'group_activity', label: 'Group Activity', rows: 6 },
      { key: 'group_answers', label: 'Group Activity — Answer Key', rows: 4 },
      { key: 'inclusion_strategy', label: 'Inclusion Strategy', rows: 4 },
      { key: 'practical_applications', label: 'Finding Practical Applications of Concepts and Skills in Daily Living', rows: 4 },
      { key: 'generalizations', label: 'Making Generalizations', rows: 4 },
      { key: 'abstraction', label: 'Abstraction', rows: 6 },
      { key: 'learning_resources', label: 'Learning Resources', rows: 3 },
      { key: 'integration', label: 'Opportunities for Integration', rows: 3, hint: 'Write N/A when there is none.' },
    ],
  },
  {
    title: 'Assessment',
    fields: [
      { key: 'formative_assessment', label: 'Formative Assessment', rows: 6 },
      { key: 'formative_answer_key', label: 'Formative Assessment — Answer Key', rows: 4 },
    ],
  },
  {
    title: 'Ways Forward',
    fields: [
      { key: 'extended_learning', label: 'Extended Learning Opportunities', rows: 5 },
      { key: 'extended_answer_key', label: 'Extended Learning — Answer Key', rows: 4 },
      { key: 'reflections', label: 'Reflections', rows: 5, hint: 'Fill in after teaching, when you know what to change next time.' },
    ],
  },
];

function periodLabelForYear(academicYear: string | null | undefined): string {
  const start = Number(String(academicYear || '').slice(0, 4));
  return !Number.isNaN(start) && start < 2026 ? 'Quarter' : 'Term';
}

function periodsForYear(academicYear: string | null | undefined): number[] {
  return periodLabelForYear(academicYear) === 'Quarter' ? [1, 2, 3, 4] : [1, 2, 3];
}

function blankForm(classId: number, checkedBy: string): LessonPlanForm {
  const form = {
    class_id: classId,
    quarter: 1,
    week_number: 1,
    session_date: todayIso(),
    lesson_title: '',
    references: '',
    ai_use: 'none' as const,
    ai_declaration: '',
    competency: '',
    objective_knowledge: '',
    objective_skill: '',
    objective_attitude: '',
    objective_values: '',
    learner_context: '',
    pre_lesson: '',
    flow: '',
    individual_activity: '',
    individual_answers: '',
    group_activity: '',
    group_answers: '',
    inclusion_strategy: '',
    practical_applications: '',
    generalizations: '',
    abstraction: '',
    learning_resources: '',
    integration: '',
    formative_assessment: '',
    formative_answer_key: '',
    extended_learning: '',
    extended_answer_key: '',
    reflections: '',
    checked_by_name: checkedBy,
    status: 'draft' as const,
  };
  return form;
}

function formFromPlan(plan: LessonPlan): LessonPlanForm {
  return {
    class_id: plan.class_id,
    quarter: plan.quarter,
    week_number: plan.week_number,
    session_date: plan.session_date,
    lesson_title: plan.lesson_title,
    references: plan.references,
    ai_use: plan.ai_use,
    ai_declaration: plan.ai_declaration,
    competency: plan.competency,
    objective_knowledge: plan.objective_knowledge,
    objective_skill: plan.objective_skill,
    objective_attitude: plan.objective_attitude,
    objective_values: plan.objective_values,
    learner_context: plan.learner_context,
    pre_lesson: plan.pre_lesson,
    flow: plan.flow,
    individual_activity: plan.individual_activity,
    individual_answers: plan.individual_answers,
    group_activity: plan.group_activity,
    group_answers: plan.group_answers,
    inclusion_strategy: plan.inclusion_strategy,
    practical_applications: plan.practical_applications,
    generalizations: plan.generalizations,
    abstraction: plan.abstraction,
    learning_resources: plan.learning_resources,
    integration: plan.integration,
    formative_assessment: plan.formative_assessment,
    formative_answer_key: plan.formative_answer_key,
    extended_learning: plan.extended_learning,
    extended_answer_key: plan.extended_answer_key,
    reflections: plan.reflections,
    checked_by_name: plan.checked_by_name ?? '',
    status: plan.status,
  };
}

@Component({
  selector: 'app-teacher-lesson-plans',
  imports: [FormsModule, DropdownComponent, IconComponent, ModalComponent, LessonPlanPrintComponent],
  templateUrl: './lesson-plans.component.html',
  styleUrl: './lesson-plans.component.css',
})
export class TeacherLessonPlansComponent {
  private readonly plansService = inject(LessonPlansService);
  private readonly classesService = inject(ClassesService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(TeacherAuthService);
  protected readonly year = inject(ViewingYearService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly plans = signal<LessonPlan[]>([]);
  protected readonly classes = signal<ClassItem[]>([]);

  protected readonly classFilter = signal<number | null>(null);
  protected readonly statusFilter = signal('');
  protected readonly quarterFilter = signal<number | null>(null);
  protected readonly searchQuery = signal('');

  protected readonly mode = signal<'list' | 'edit' | 'print'>('list');
  protected readonly editingId = signal<number | null>(null);
  protected readonly form = signal<LessonPlanForm>(blankForm(0, ''));
  protected readonly dirty = signal(false);
  private savedSnapshot = '';
  protected readonly saving = signal(false);
  protected readonly formErrors = signal<FieldErrors>({});
  protected readonly detail = signal<LessonPlanDetail | null>(null);
  protected readonly detailLoading = signal(false);

  protected readonly deleteTarget = signal<LessonPlan | null>(null);
  protected readonly duplicateTarget = signal<LessonPlan | null>(null);
  protected readonly duplicateWeek = signal(1);
  protected readonly duplicateDate = signal(todayIso());
  protected readonly busy = signal(false);

  protected readonly sections = FIELD_SECTIONS;

  protected readonly classOptions = computed<DropdownOption[]>(() =>
    this.classes().map((klass) => ({
      value: klass.id,
      label: `${klass.subject_name} · ${klass.section_name}`,
      sub: `Grade ${klass.grade_level} · ${klass.academic_year}`,
    }))
  );

  protected readonly periodOptions = computed<DropdownOption[]>(() => {
    const klass = this.classes().find((item) => item.id === this.form().class_id);
    const label = periodLabelForYear(klass?.academic_year ?? this.year.selectedYear());
    return periodsForYear(klass?.academic_year ?? this.year.selectedYear()).map((period) => ({
      value: period,
      label: `${label} ${period}`,
    }));
  });

  protected readonly periodOptionsForFilter = computed<DropdownOption[]>(() => {
    const label = periodLabelForYear(this.year.selectedYear());
    return periodsForYear(this.year.selectedYear()).map((period) => ({
      value: period,
      label: `${label} ${period}`,
    }));
  });

  protected readonly filteredPlans = computed(() => {
    const classId = this.classFilter();
    const status = this.statusFilter();
    const quarter = this.quarterFilter();
    const query = this.searchQuery().trim().toLowerCase();
    return this.plans().filter(
      (plan) =>
        (classId === null || plan.class_id === classId) &&
        (status === '' || plan.status === status) &&
        (quarter === null || plan.quarter === quarter) &&
        (!query ||
          `${plan.lesson_title} ${plan.references} ${plan.subject_name} ${plan.section_name}`.toLowerCase().includes(query))
    );
  });

  protected readonly formPeriodLabel = computed(() => {
    const klass = this.classes().find((item) => item.id === this.form().class_id);
    return periodLabelForYear(klass?.academic_year ?? this.year.selectedYear());
  });

  protected readonly formErrorList = computed(() => Object.entries(this.formErrors()));

  constructor() {
    effect(() => {
      const selected = this.year.selectedYear();
      if (selected || this.year.loaded()) this.load();
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (this.hasUnsavedChanges()) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', beforeUnload));
  }

  // Leaving the page, or closing the tab, with an unsaved plan asks first.
  hasUnsavedChanges(): boolean {
    return this.mode() === 'edit' && this.dirty();
  }

  protected periodLabel(plan: LessonPlan): string {
    return plan.period_label || periodLabelForYear(plan.academic_year);
  }

  protected statusLabel(status: LessonPlan['status']): string {
    return status === 'draft' ? 'Draft' : status === 'ready' ? 'Ready' : 'Taught';
  }

  protected load(): void {
    const selectedYear = this.year.selectedYear();
    this.loading.set(true);
    this.loadError.set('');
    this.classesService.classes({ academic_year: selectedYear ?? '', page_size: 100 }).subscribe({
      next: (response) => this.classes.set(response.items),
      error: (error: unknown) => {
        this.loadError.set(errorMessage(error));
        this.loading.set(false);
      },
    });
    this.plansService.list({ academic_year: selectedYear ?? '' }).subscribe({
      next: (response) => {
        this.plans.set(response.items);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(errorMessage(error));
        this.loading.set(false);
      },
    });
  }

  protected formatDate(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (!year || !month || !day) return iso;
    return `${months[month - 1]} ${day}, ${year}`;
  }

  // ---------- Editor ----------

  protected openNew(): void {
    const first = this.classes()[0];
    if (!first) return;
    this.formErrors.set({});
    this.editingId.set(null);
    const form = blankForm(first.id, this.auth.teacher()?.school_head_name ?? '');
    this.form.set(form);
    this.savedSnapshot = JSON.stringify(form);
    this.dirty.set(false);
    this.detail.set(null);
    this.mode.set('edit');
  }

  protected openEdit(plan: LessonPlan): void {
    this.formErrors.set({});
    this.detailLoading.set(true);
    this.plansService.detail(plan.id).subscribe({
      next: (response) => {
        this.editingId.set(plan.id);
        const form = formFromPlan(response.plan);
        this.form.set(form);
        this.savedSnapshot = JSON.stringify(form);
        this.dirty.set(false);
        this.detail.set(response);
        this.detailLoading.set(false);
        this.mode.set('edit');
      },
      error: (error: unknown) => {
        this.detailLoading.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected setField(key: keyof LessonPlanForm, value: string | number): void {
    this.form.update((form) => ({ ...form, [key]: value }));
    this.dirty.set(JSON.stringify(this.form()) !== this.savedSnapshot);
  }

  protected onFormClassChange(value: string | number): void {
    const classId = value === '' ? 0 : Number(value);
    this.form.update((form) => ({ ...form, class_id: classId, quarter: 1 }));
    this.dirty.set(JSON.stringify(this.form()) !== this.savedSnapshot);
  }

  protected onQuarterChange(value: string | number): void {
    this.setField('quarter', Number(value));
  }

  protected textField(key: keyof LessonPlanForm): string {
    return String(this.form()[key] ?? '');
  }

  protected onAiUseChange(value: 'none' | 'used'): void {
    this.form.update((form) => {
      const declaration =
        value === 'used' && form.ai_declaration.includes('No AI tools were used') ? '' : form.ai_declaration;
      return { ...form, ai_use: value, ai_declaration: declaration };
    });
    this.dirty.set(JSON.stringify(this.form()) !== this.savedSnapshot);
  }

  // Plain Save never carries a status change: the stored status is left
  // alone, so a draft can always be saved mid-work. A status change
  // only happens through an explicit action below, which is what the
  // server's Ready check guards.
  protected save(): void {
    this.saveWithStatus();
  }

  protected saveAndMarkReady(): void {
    this.saveWithStatus('ready');
  }

  protected markTaught(): void {
    this.saveWithStatus('taught');
  }

  protected backToDraft(): void {
    this.saveWithStatus('draft');
  }

  private saveWithStatus(status?: LessonPlan['status']): void {
    const form = this.form();
    if (!form.class_id) {
      this.formErrors.set({ class_id: 'Choose a class.' });
      return;
    }
    if (!form.lesson_title.trim()) {
      this.formErrors.set({ lesson_title: 'Give the lesson a title.' });
      return;
    }
    this.saving.set(true);
    this.formErrors.set({});
    const id = this.editingId();
    const { status: _currentStatus, ...content } = form;
    const payload: Partial<LessonPlanForm> = status ? { ...content, status } : content;
    const request = id ? this.plansService.update(id, payload) : this.plansService.create(payload);
    request.subscribe({
      next: (response) => {
        const plan = response.plan;
        this.plans.update((items) =>
          id ? items.map((item) => (item.id === id ? plan : item)) : [plan, ...items]
        );
        this.editingId.set(plan.id);
        const nextForm = formFromPlan(plan);
        this.form.set(nextForm);
        this.savedSnapshot = JSON.stringify(nextForm);
        this.dirty.set(false);
        this.saving.set(false);
        this.toast.success('Lesson plan saved.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.formErrors.set(fieldErrors(error));
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected discardChanges(): void {
    if (!window.confirm('Discard the changes you have not saved?')) return;
    const id = this.editingId();
    if (id === null) {
      this.backToList(true);
      return;
    }
    const plan = this.plans().find((item) => item.id === id);
    if (plan) this.openEdit(plan);
  }

  protected backToList(force = false): void {
    if (!force && this.hasUnsavedChanges()) {
      if (!window.confirm('You have unsaved changes in this lesson plan. Leave without saving them?')) return;
    }
    this.mode.set('list');
    this.detail.set(null);
    this.editingId.set(null);
    this.dirty.set(false);
  }

  // ---------- Print ----------

  protected openPrint(plan: LessonPlan): void {
    this.detailLoading.set(true);
    this.plansService.detail(plan.id).subscribe({
      next: (response) => {
        this.detail.set(response);
        this.detailLoading.set(false);
        this.mode.set('print');
      },
      error: (error: unknown) => {
        this.detailLoading.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected print(): void {
    window.print();
  }

  protected openPrintForEditing(): void {
    const id = this.editingId();
    const plan = id === null ? undefined : this.plans().find((item) => item.id === id);
    if (plan) this.openPrint(plan);
  }

  // ---------- Duplicate and delete ----------

  protected openDuplicate(plan: LessonPlan): void {
    this.duplicateTarget.set(plan);
    this.duplicateWeek.set(Math.min(plan.week_number + 1, 52));
    this.duplicateDate.set(this.addDays(plan.session_date, 7));
    this.formErrors.set({});
  }

  private addDays(iso: string, days: number): string {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  protected confirmDuplicate(): void {
    const target = this.duplicateTarget();
    if (!target) return;
    this.busy.set(true);
    this.plansService.duplicate(target.id, { week_number: this.duplicateWeek(), session_date: this.duplicateDate() }).subscribe({
      next: (response) => {
        this.plans.update((items) => [response.plan, ...items]);
        this.duplicateTarget.set(null);
        this.busy.set(false);
        this.toast.success('Lesson plan copied as a draft.');
        this.openEdit(response.plan);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.formErrors.set(fieldErrors(error));
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target) return;
    this.busy.set(true);
    this.plansService.remove(target.id).subscribe({
      next: () => {
        this.plans.update((items) => items.filter((item) => item.id !== target.id));
        this.deleteTarget.set(null);
        this.busy.set(false);
        if (this.editingId() === target.id || this.detail()?.plan.id === target.id) {
          this.mode.set('list');
          this.detail.set(null);
          this.editingId.set(null);
          this.dirty.set(false);
        }
        this.toast.success('Lesson plan deleted.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.toast.error(errorMessage(error));
      },
    });
  }

  protected onClassFilterChange(value: string | number): void {
    this.classFilter.set(value === '' ? null : Number(value));
  }

  protected onQuarterFilterChange(value: string | number): void {
    this.quarterFilter.set(value === '' ? null : Number(value));
  }

  protected onStatusFilterChange(value: string | number): void {
    this.statusFilter.set(String(value));
  }
}
