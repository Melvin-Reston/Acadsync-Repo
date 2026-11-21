// Classes & Sections: the teacher's own subjects, classes, sections and learners.
// Grouped by subject, like the earlier Classes & Sections design: one card per subject
// with its sections inside. Learners live here too, so student counts are real and
// Batch 3 (Attendance) has a roster to work from.
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { errorMessage, fieldErrors, time12 } from '../../../core/helpers';
import { BulkUploadResult, ClassItem, ClassLearner, FieldErrors, Learner, Subject } from '../../../core/models';
import { ClassesService, ClassForm, LearnerForm } from '../../../core/classes.service';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import { ToastService } from '../../../core/toast.service';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';
import { MenuComponent, MenuItem } from '../../../shared/menu.component';
import { ModalComponent } from '../../../shared/modal.component';
import { QrCardComponent, QrLearner } from '../../../shared/qr-card.component';

interface SubjectGroup {
  subjectId: number;
  subjectName: string;
  gradeLevel: number;
  classes: ClassItem[];
  students: number;
}

type DeleteTarget =
  | { kind: 'class'; item: ClassItem }
  | { kind: 'learner'; item: Learner }
  | { kind: 'subject'; item: Subject };

@Component({
  selector: 'app-teacher-classes',
  imports: [FormsModule, DropdownComponent, IconComponent, MenuComponent, ModalComponent, QrCardComponent],
  templateUrl: './classes.component.html',
  styleUrl: './classes.component.css',
})
export class TeacherClassesComponent {
  private readonly classesService = inject(ClassesService);
  private readonly portal = inject(TeacherPortalService);
  private readonly toast = inject(ToastService);

  protected readonly classes = signal<ClassItem[]>([]);
  protected readonly subjects = signal<Subject[]>([]);
  protected readonly learners = signal<Learner[]>([]);
  protected readonly academicYear = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly saving = signal(false);
  protected readonly formErrors = signal<FieldErrors>({});

  protected readonly tab = signal<'classes' | 'learners'>('classes');
  protected readonly view = signal<'tiles' | 'list'>('tiles');
  protected readonly search = signal('');
  protected readonly gradeFilter = signal<number | ''>('');
  protected readonly yearFilter = signal('');
  protected readonly learnerSearch = signal('');

  // The Learners tab shows the whole school directory, or the roster of one
  // class when a class is picked. '' means the whole directory.
  protected readonly rosterClassId = signal<number | ''>('');
  protected readonly rosterClassLearners = signal<ClassLearner[]>([]);

  // Bulk upload (CSV) of learners into the school directory.
  protected readonly uploadOpen = signal(false);
  protected readonly uploadResult = signal<BulkUploadResult | null>(null);
  protected readonly uploading = signal(false);
  protected uploadFile: File | null = null;

  // The 3-dots actions on a learner row: QR Card, Edit, Delete. On a class
  // roster (a class picked on the Learners tab) the menu also offers
  // "Remove from class" — the roster lives in the tab, not in the modal.
  protected readonly learnerMenuItems = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [
      { value: 'qr', label: 'QR Card' },
      { value: 'edit', label: 'Edit' },
      { value: 'delete', label: 'Delete', danger: true },
    ];
    if (this.rosterClassId() !== '') {
      items.push({ value: 'remove', label: 'Remove from class', danger: true });
    }
    return items;
  });

  protected readonly expandedSubject = signal<number | null>(null);
  protected readonly expandedDetail = signal<{
    classId: number;
    classLabel: string;
    learners: ClassLearner[];
    meetings: { day_name: string; start_time: string; end_time: string; room: string }[];
  } | null>(null);

  // The learner whose QR pass card is open (with the class it is shown for).
  protected readonly qrLearner = signal<{ learner: QrLearner; classLabel: string } | null>(null);

  // Add / edit class
  protected readonly classFormOpen = signal(false);
  protected editingClass: ClassItem | null = null;
  protected subjectChoice: 'existing' | 'new' = 'existing';
  protected formSubjectId: number | null = null;
  protected formNewSubject = '';
  protected formGrade: number | '' = 10;
  protected formSection = '';
  protected formRoom = '';
  protected formYear = '';

  // Manage subjects
  protected readonly subjectsOpen = signal(false);
  protected newSubjectName = '';
  protected newSubjectGrade: number | '' = 10;
  // The subject group decides the default weights under DO 015 (core
  // 20/50/30, MAPEH and EPP/TLE 20/60/20). It is guessed from the name as
  // the teacher types, until the teacher picks one.
  protected newSubjectGroup: 'core' | 'mapeh' | 'epp_tle' = 'core';
  protected newSubjectGroupTouched = false;
  protected editingSubjectId: number | null = null;
  protected editingSubjectName = '';
  protected editingSubjectGroup: 'core' | 'mapeh' | 'epp_tle' = 'core';

  // Enrol learners into a class
  protected readonly enrolClass = signal<ClassItem | null>(null);
  // The ids already enrolled in the open modal's class — only used to keep
  // them out of the "Enrol a learner" picker. The roster itself lives on
  // the Learners tab, not in the modal.
  protected readonly enrolledLearnerIds = signal<Set<number>>(new Set());
  protected enrolLearnerId: number | null = null;
  protected quickFirst = '';
  protected quickLast = '';
  protected quickId = '';
  protected quickSex: 'Male' | 'Female' = 'Female';
  protected quickBirthdate = '';

  // Add / edit learner
  protected readonly learnerFormOpen = signal(false);
  protected editingLearner: Learner | null = null;
  protected learnerFirst = '';
  protected learnerLast = '';
  protected learnerIdText = '';
  protected learnerSex: 'Male' | 'Female' = 'Female';
  protected learnerBirthdate = '';

  // Delete confirmation
  protected readonly deleteTarget = signal<DeleteTarget | null>(null);

  protected readonly time12 = time12;

  protected readonly filteredClasses = computed(() => {
    const query = this.search().trim().toLowerCase();
    return this.classes().filter((klass) => {
      if (this.gradeFilter() !== '' && klass.grade_level !== this.gradeFilter()) return false;
      if (this.yearFilter() !== '' && klass.academic_year !== this.yearFilter()) return false;
      if (!query) return true;
      return `${klass.subject_name} ${klass.section_name} ${klass.room}`
        .toLowerCase()
        .includes(query);
    });
  });

  protected readonly groups = computed<SubjectGroup[]>(() => {
    const bySubject = new Map<number, SubjectGroup>();
    for (const klass of this.filteredClasses()) {
      let group = bySubject.get(klass.subject_id);
      if (!group) {
        group = {
          subjectId: klass.subject_id,
          subjectName: klass.subject_name,
          gradeLevel: klass.grade_level,
          classes: [],
          students: 0,
        };
        bySubject.set(klass.subject_id, group);
      }
      group.classes.push(klass);
      group.students += klass.learner_count;
    }
    return [...bySubject.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  });

  protected readonly years = computed(() => {
    const years = new Set(this.classes().map((klass) => klass.academic_year));
    return [...years].sort().reverse();
  });

  protected readonly grades = computed(() => {
    const grades = new Set(this.classes().map((klass) => klass.grade_level));
    return [...grades].sort((a, b) => a - b);
  });

  protected readonly totalStudents = computed(() =>
    this.classes().reduce((sum, klass) => sum + klass.learner_count, 0),
  );

  protected readonly filteredLearners = computed(() => {
    const query = this.learnerSearch().trim().toLowerCase();
    if (!query) return this.learners();
    return this.learners().filter((learner) =>
      `${learner.first_name} ${learner.last_name} ${learner.learner_id}`
        .toLowerCase()
        .includes(query),
    );
  });

  protected readonly availableLearners = computed(() => {
    const enrolled = this.enrolledLearnerIds();
    return this.learners().filter((learner) => !enrolled.has(learner.id));
  });

  // The class picker on the Learners tab: the whole directory, or one class.
  protected readonly rosterOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'All learners' },
    ...this.classes().map((klass) => ({
      value: klass.id,
      label: `${klass.subject_name} · ${klass.section_name}`,
      sub: `Grade ${klass.grade_level} · AY ${klass.academic_year}`,
    })),
  ]);

  // The rows of the Learners tab: the whole school directory, or the roster
  // of the picked class. Both carry birthdate and school.
  protected readonly rosterRows = computed(() => {
    const query = this.learnerSearch().trim().toLowerCase();
    const rows =
      this.rosterClassId() === ''
        ? this.learners()
        : this.rosterClassLearners();
    const mapped = rows.map((learner) => ({
      id: learner.id,
      first_name: learner.first_name,
      last_name: learner.last_name,
      learner_id: learner.learner_id,
      sex: learner.sex,
      birthdate: learner.birthdate,
      school_name: learner.school_name,
    }));
    if (!query) return mapped;
    return mapped.filter((learner) =>
      `${learner.first_name} ${learner.last_name} ${learner.learner_id} ${learner.school_name}`
        .toLowerCase()
        .includes(query),
    );
  });

  protected readonly gradeOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'All grades' },
    ...this.grades().map((grade) => ({ value: grade, label: `Grade ${grade}` })),
  ]);

  protected readonly yearOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'All years' },
    ...this.years().map((year) => ({ value: year, label: `AY ${year}` })),
  ]);

  protected readonly gradeLevelOptions: DropdownOption[] = [7, 8, 9, 10, 11, 12].map((grade) => ({
    value: grade,
    label: `Grade ${grade}`,
  }));

  protected readonly subjectOptions = computed<DropdownOption[]>(() =>
    this.subjects().map((subject) => ({
      value: subject.id,
      label: `${subject.name} · Grade ${subject.grade_level}`,
      sub: `${subject.class_count} ${subject.class_count === 1 ? 'class' : 'classes'}`,
    })),
  );

  protected readonly sexOptions: DropdownOption[] = [
    { value: 'Female', label: 'Female' },
    { value: 'Male', label: 'Male' },
  ];

  protected readonly subjectGroupOptions: DropdownOption[] = [
    { value: 'core', label: 'Core' },
    { value: 'mapeh', label: 'MAPEH' },
    { value: 'epp_tle', label: 'EPP/TLE' },
  ];

  protected readonly enrolLearnerOptions = computed<DropdownOption[]>(() =>
    this.availableLearners().map((learner) => ({
      value: learner.id,
      label: `${learner.last_name}, ${learner.first_name}`,
      sub: learner.learner_id,
    })),
  );

  protected initialsOf(learner: { first_name: string; last_name: string }): string {
    return `${learner.first_name[0] ?? ''}${learner.last_name[0] ?? ''}`.toUpperCase();
  }

  protected onRosterClassChange(value: number | '' | null): void {
    const classId = value ?? '';
    this.rosterClassId.set(classId);
    if (classId === '') {
      this.rosterClassLearners.set([]);
      return;
    }
    this.classesService.classLearners(classId).subscribe({
      next: (response) => this.rosterClassLearners.set(response.items),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected learnerMenuAction(
    action: string,
    learner: { id: number; first_name: string; last_name: string; learner_id: string; sex: 'Male' | 'Female'; birthdate: string | null; school_name: string },
  ): void {
    if (action === 'qr') {
      this.qrLearner.set({ learner, classLabel: '' });
      return;
    }
    if (action === 'edit') {
      this.openEditLearner(learner as Learner);
      return;
    }
    if (action === 'remove') {
      this.removeFromClass(learner.id);
      return;
    }
    if (action === 'delete') {
      this.deleteTarget.set({ kind: 'learner', item: learner as Learner });
    }
  }

  // Unenrol a learner from the class picked on the Learners tab. The old
  // modal Remove button did this with no confirmation, so neither does this.
  protected removeFromClass(learnerId: number): void {
    const classId = this.rosterClassId();
    if (classId === '') return;
    this.classesService.removeLearner(classId, learnerId).subscribe({
      next: () => {
        this.toast.success('Learner removed from the class.');
        this.load();
      },
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  // ---------- Bulk upload ----------

  protected openUpload(): void {
    this.uploadFile = null;
    this.uploadResult.set(null);
    this.error.set('');
    this.uploadOpen.set(true);
  }

  protected onUploadFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.uploadFile = input.files?.[0] ?? null;
    this.uploadResult.set(null);
  }

  protected downloadUploadTemplate(): void {
    this.classesService.downloadLearnerTemplate();
  }

  protected uploadCsv(): void {
    if (!this.uploadFile) return;
    this.uploading.set(true);
    this.classesService.uploadLearners(this.uploadFile).subscribe({
      next: (result) => {
        this.uploading.set(false);
        this.uploadResult.set(result);
        this.uploadFile = null;
        this.toast.success(
          `${result.summary.added} added, ${result.summary.skipped} skipped, ${result.summary.failed} with errors.`,
        );
        this.load();
      },
      error: (error) => {
        this.uploading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  constructor() {
    this.portal.me().subscribe({
      next: (response) => this.academicYear.set(response.academic_year),
      error: () => undefined,
    });
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.classesService.classes({}).subscribe({
      next: (response) => {
        this.classes.set(response.items);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
    this.classesService.subjects().subscribe({
      next: (response) => this.subjects.set(response.items),
      error: () => undefined,
    });
    this.classesService.learners().subscribe({
      next: (response) => this.learners.set(response.items),
      error: () => undefined,
    });
    // A class roster showing on the Learners tab is re-read after any change.
    if (this.rosterClassId() !== '') {
      this.onRosterClassChange(this.rosterClassId());
    }
  }

  protected toggleSubject(subjectId: number): void {
    this.expandedSubject.set(this.expandedSubject() === subjectId ? null : subjectId);
  }

  protected toggleDetail(klass: ClassItem): void {
    if (this.expandedDetail()?.classId === klass.id) {
      this.expandedDetail.set(null);
      return;
    }
    this.classesService.classDetail(klass.id).subscribe({
      next: (response) =>
        this.expandedDetail.set({
          classId: klass.id,
          classLabel: `${response.class.subject_name} · ${response.class.section_name}`,
          learners: response.class.learners,
          meetings: response.class.meetings,
        }),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  // ---------- Class form ----------

  protected openAddClass(): void {
    this.editingClass = null;
    this.subjectChoice = this.subjects().length > 0 ? 'existing' : 'new';
    this.formSubjectId = this.subjects()[0]?.id ?? null;
    this.formNewSubject = '';
    this.formGrade = 10;
    this.formSection = '';
    this.formRoom = '';
    this.formYear = this.academicYear() ?? '';
    this.formErrors.set({});
    this.classFormOpen.set(true);
  }

  protected openEditClass(klass: ClassItem): void {
    this.editingClass = klass;
    this.subjectChoice = 'existing';
    this.formSubjectId = klass.subject_id;
    this.formNewSubject = '';
    this.formGrade = klass.grade_level;
    this.formSection = klass.section_name;
    this.formRoom = klass.room;
    this.formYear = klass.academic_year;
    this.formErrors.set({});
    this.classFormOpen.set(true);
  }

  protected chosenSubject(): Subject | undefined {
    return this.subjects().find((subject) => subject.id === this.formSubjectId);
  }

  protected saveClass(): void {
    const grade =
      this.subjectChoice === 'existing'
        ? (this.chosenSubject()?.grade_level ?? Number(this.formGrade))
        : Number(this.formGrade);
    const form: ClassForm = {
      subject_id: this.subjectChoice === 'existing' ? this.formSubjectId : null,
      new_subject_name: this.formNewSubject.trim(),
      grade_level: grade,
      section_name: this.formSection.trim(),
      room: this.formRoom.trim(),
      academic_year: this.formYear.trim(),
    };
    this.saving.set(true);
    const request = this.editingClass
      ? this.classesService.updateClass(this.editingClass.id, form)
      : this.classesService.createClass(form);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.classFormOpen.set(false);
        this.toast.success(
          this.editingClass ? 'Class updated.' : 'Class added.',
        );
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.formErrors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
      },
    });
  }

  // ---------- Subjects ----------

  protected openSubjects(): void {
    this.newSubjectName = '';
    this.newSubjectGrade = 10;
    this.newSubjectGroup = 'core';
    this.newSubjectGroupTouched = false;
    this.editingSubjectId = null;
    this.editingSubjectName = '';
    this.editingSubjectGroup = 'core';
    this.formErrors.set({});
    this.subjectsOpen.set(true);
  }

  // The group a subject belongs to, guessed from its name (Music and Arts
  // is MAPEH). The teacher can always pick another group.
  protected detectSubjectGroup(name: string): 'core' | 'mapeh' | 'epp_tle' {
    const lower = name.toLowerCase();
    if (
      lower.includes('music') || lower.includes('arts') ||
      lower.includes('physical education') || lower.includes('health') ||
      lower === 'pe' || lower.startsWith('pe ') || lower.endsWith(' pe')
    ) {
      return 'mapeh';
    }
    if (
      lower.startsWith('epp') || lower.includes(' epp') ||
      lower.startsWith('tle') || lower.includes(' tle') || lower.endsWith('tle')
    ) {
      return 'epp_tle';
    }
    return 'core';
  }

  protected onNewSubjectNameChange(): void {
    if (!this.newSubjectGroupTouched) {
      this.newSubjectGroup = this.detectSubjectGroup(this.newSubjectName);
    }
  }

  protected subjectGroupLabel(group: string): string {
    if (group === 'mapeh') return 'MAPEH';
    if (group === 'epp_tle') return 'EPP/TLE';
    return 'Core';
  }

  protected addSubject(): void {
    if (!this.newSubjectName.trim() || this.newSubjectGrade === '') return;
    this.saving.set(true);
    this.classesService
      .createSubject({ name: this.newSubjectName.trim(), grade_level: Number(this.newSubjectGrade), group: this.newSubjectGroup })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.newSubjectName = '';
          this.newSubjectGroup = 'core';
          this.newSubjectGroupTouched = false;
          this.toast.success('Subject added.');
          this.load();
        },
        error: (error) => {
          this.saving.set(false);
          this.formErrors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  protected startEditSubject(subject: Subject): void {
    this.editingSubjectId = subject.id;
    this.editingSubjectName = subject.name;
    this.editingSubjectGroup = subject.group;
  }

  protected saveSubjectName(subject: Subject): void {
    if (!this.editingSubjectName.trim()) return;
    this.saving.set(true);
    this.classesService
      .updateSubject(subject.id, {
        name: this.editingSubjectName.trim(),
        grade_level: subject.grade_level,
        group: this.editingSubjectGroup,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editingSubjectId = null;
          this.toast.success('Subject updated.');
          this.load();
        },
        error: (error) => {
          this.saving.set(false);
          this.formErrors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  // ---------- Enrolment ----------

  protected openEnrol(klass: ClassItem): void {
    this.enrolClass.set(klass);
    this.enrolLearnerId = null;
    this.quickFirst = '';
    this.quickLast = '';
    this.quickId = '';
    this.quickSex = 'Female';
    this.quickBirthdate = '';
    this.formErrors.set({});
    this.refreshEnrolledIds(klass.id);
  }

  private refreshEnrolledIds(classId: number): void {
    this.classesService.classLearners(classId).subscribe({
      next: (response) =>
        this.enrolledLearnerIds.set(new Set(response.items.map((learner) => learner.id))),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected enrolSelected(): void {
    const klass = this.enrolClass();
    if (!klass || !this.enrolLearnerId) return;
    this.saving.set(true);
    this.classesService.enrolLearner(klass.id, this.enrolLearnerId).subscribe({
      next: () => {
        this.saving.set(false);
        this.enrolLearnerId = null;
        this.refreshEnrolledIds(klass.id);
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.formErrors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
      },
    });
  }

  protected quickAddLearner(): void {
    const klass = this.enrolClass();
    if (!klass || !this.quickFirst.trim() || !this.quickLast.trim() || !this.quickId.trim()) return;
    this.saving.set(true);
    this.classesService
      .createLearner({
        first_name: this.quickFirst.trim(),
        last_name: this.quickLast.trim(),
        learner_id: this.quickId.trim(),
        sex: this.quickSex,
        birthdate: this.quickBirthdate || '',
      })
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          this.quickFirst = '';
          this.quickLast = '';
          this.quickId = '';
          this.quickBirthdate = '';
          this.classesService.enrolLearner(klass.id, response.learner.id).subscribe({
            next: () => {
              this.refreshEnrolledIds(klass.id);
              this.load();
            },
            error: (error) => this.error.set(errorMessage(error)),
          });
        },
        error: (error) => {
          this.saving.set(false);
          this.formErrors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  // ---------- Learners ----------

  protected openAddLearner(): void {
    this.editingLearner = null;
    this.learnerFirst = '';
    this.learnerLast = '';
    this.learnerIdText = '';
    this.learnerSex = 'Female';
    this.learnerBirthdate = '';
    this.formErrors.set({});
    this.learnerFormOpen.set(true);
  }

  protected openEditLearner(learner: Learner): void {
    this.editingLearner = learner;
    this.learnerFirst = learner.first_name;
    this.learnerLast = learner.last_name;
    this.learnerIdText = learner.learner_id;
    this.learnerSex = learner.sex;
    this.learnerBirthdate = learner.birthdate ?? '';
    this.formErrors.set({});
    this.learnerFormOpen.set(true);
  }

  protected saveLearner(): void {
    const form: LearnerForm = {
      first_name: this.learnerFirst.trim(),
      last_name: this.learnerLast.trim(),
      learner_id: this.learnerIdText.trim(),
      sex: this.learnerSex,
      birthdate: this.learnerBirthdate || '',
    };
    this.saving.set(true);
    const request = this.editingLearner
      ? this.classesService.updateLearner(this.editingLearner.id, form)
      : this.classesService.createLearner(form);
    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.learnerFormOpen.set(false);
        this.toast.success(this.editingLearner ? 'Learner updated.' : 'Learner added.');
        this.load();
      },
      error: (error) => {
        this.saving.set(false);
        this.formErrors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
      },
    });
  }

  // ---------- Delete ----------

  protected confirmDelete(): void {
    const target = this.deleteTarget();
    if (!target) return;
    const request =
      target.kind === 'class'
        ? this.classesService.deleteClass(target.item.id)
        : target.kind === 'learner'
          ? this.classesService.deleteLearner(target.item.id)
          : this.classesService.deleteSubject(target.item.id);
    request.subscribe({
      next: () => {
        this.deleteTarget.set(null);
        this.toast.success('Deleted.');
        this.load();
      },
      error: (error) => {
        this.deleteTarget.set(null);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected deleteTitle(): string {
    const target = this.deleteTarget();
    if (!target) return '';
    if (target.kind === 'class') {
      return `Delete ${target.item.subject_name} · ${target.item.section_name}?`;
    }
    if (target.kind === 'learner') {
      return `Delete ${target.item.first_name} ${target.item.last_name}?`;
    }
    return `Delete ${target.item.name}?`;
  }

  protected deleteText(): string {
    const target = this.deleteTarget();
    if (!target) return '';
    if (target.kind === 'class') {
      return 'This removes the class, its enrolments and its meetings. This cannot be undone.';
    }
    if (target.kind === 'learner') {
      return 'This removes the learner from the school directory. A learner who is enrolled in a class, or who has attendance or grade records, cannot be deleted.';
    }
    return 'A subject in use by a class cannot be deleted.';
  }
}
