// The Add teacher / Edit teacher pop-up. Pass a teacher to edit, or nothing to create one.
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage, fieldErrors, planPrice } from '../core/helpers';
import { FieldErrors, Plan, School, Teacher, TeacherForm } from '../core/models';
import { PlansService } from '../core/plans.service';
import { SchoolsService } from '../core/schools.service';
import { TeachersService } from '../core/teachers.service';
import { DropdownComponent, DropdownOption } from './dropdown.component';
import { IconComponent } from './icon.component';
import { ModalComponent } from './modal.component';

@Component({
  selector: 'app-teacher-form',
  imports: [FormsModule, RouterLink, DropdownComponent, ModalComponent, IconComponent],
  templateUrl: './teacher-form.component.html',
})
export class TeacherFormComponent implements OnInit {
  private readonly teachers = inject(TeachersService);
  private readonly schoolsApi = inject(SchoolsService);
  private readonly plansApi = inject(PlansService);

  readonly teacher = input<Teacher | null>(null);
  readonly saved = output<Teacher>();
  readonly closed = output<void>();

  protected form: TeacherForm = {
    first_name: '',
    last_name: '',
    email: '',
    mobile: '',
    username: '',
    school_id: null,
    present_address: '',
    temporary_password: '',
  };

  protected readonly schools = signal<School[]>([]);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly planPrice = planPrice;
  protected readonly schoolsLoaded = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly errors = signal<FieldErrors>({});

  protected readonly schoolOptions = computed<DropdownOption[]>(() =>
    this.schools().map((school) => ({
      value: school.id,
      label: `${school.name} · ${school.city_region}`,
    })),
  );

  // "No plan yet" is the '' option; the handler maps it back to null.
  protected readonly planOptions = computed<DropdownOption[]>(() => [
    { value: '', label: 'No plan yet' },
    ...this.plans().map((plan) => ({ value: plan.id, label: `${plan.name} · ${planPrice(plan)}` })),
  ]);

  ngOnInit(): void {
    const teacher = this.teacher();
    if (teacher) {
      this.form = {
        first_name: teacher.first_name,
        last_name: teacher.last_name,
        email: teacher.email,
        mobile: teacher.mobile,
        username: teacher.username,
        school_id: teacher.school_id,
        present_address: teacher.present_address,
      };
    }

    // A new teacher can be given a plan straight away.
    if (!teacher) {
      this.form.plan_id = null;
      this.form.with_trial = true;
      this.plansApi.list().subscribe({
        next: (response) => this.plans.set(response.items.filter((plan) => plan.is_active)),
        error: () => undefined,
      });
    }

    this.schoolsApi.options().subscribe({
      next: (response) => {
        this.schools.set(response.items);
        this.schoolsLoaded.set(true);
      },
      error: (error) => {
        this.schoolsLoaded.set(true);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected get chosenPlan(): Plan | null {
    return this.plans().find((plan) => plan.id === this.form.plan_id) ?? null;
  }

  // Fills the temporary password box with a random 12-character password.
  protected generatePassword(): void {
    const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
    const digits = '23456789';
    const random = new Uint32Array(12);
    crypto.getRandomValues(random);

    const characters = Array.from(random, (value, index) => {
      const pool = index === 0 ? letters : index === 1 ? digits : letters + digits;
      return pool[value % pool.length];
    });
    this.form.temporary_password = characters.reverse().join('');
  }

  protected submit(): void {
    this.error.set('');
    this.errors.set({});
    this.saving.set(true);

    const teacher = this.teacher();
    const request = teacher
      ? this.teachers.update(teacher.id, this.form)
      : this.teachers.create({ ...this.form, plan_id: this.form.plan_id ?? undefined });

    request.subscribe({
      next: (response) => {
        this.saving.set(false);
        this.saved.emit(response.teacher);
      },
      error: (error) => {
        this.saving.set(false);
        this.errors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
      },
    });
  }
}
