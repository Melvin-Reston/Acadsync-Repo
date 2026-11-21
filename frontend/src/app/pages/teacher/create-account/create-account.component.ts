// Teacher sign-up: Profile & Assignment, Credentials, Security & Terms,
// then Account Created, Choose Plan and Get Started.
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TeacherAuthService } from '../../../core/teacher-auth.service';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import {
  deriveUsername,
  errorMessage,
  fieldErrors,
  passwordStrength,
  planPrice,
} from '../../../core/helpers';
import { FieldErrors, Plan, PublicSchool, SchoolForm, TeacherSelf } from '../../../core/models';
import { AuthShellComponent } from '../../../shared/auth-shell.component';
import { DropdownComponent, DropdownOption } from '../../../shared/dropdown.component';
import { IconComponent } from '../../../shared/icon.component';
import { ModalComponent } from '../../../shared/modal.component';

type Step = 'profile' | 'credentials' | 'terms' | 'created' | 'plan' | 'started';

const STEP_ORDER: Step[] = ['profile', 'credentials', 'terms'];

@Component({
  selector: 'app-teacher-create-account',
  imports: [FormsModule, RouterLink, AuthShellComponent, IconComponent, DropdownComponent, ModalComponent],
  templateUrl: './create-account.component.html',
  styleUrl: './create-account.component.css',
})
export class TeacherCreateAccountComponent {
  private readonly auth = inject(TeacherAuthService);
  private readonly portal = inject(TeacherPortalService);
  private readonly router = inject(Router);

  protected readonly step = signal<Step>('profile');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly errors = signal<FieldErrors>({});

  // Step 1: Profile & Assignment
  protected firstName = '';
  protected lastName = '';
  protected email = '';
  protected mobile = '';
  protected presentAddress = '';
  protected schoolId: number | null = null;
  protected readonly schools = signal<PublicSchool[]>([]);
  protected readonly schoolsLoading = signal(true);

  protected readonly schoolOptions = computed<DropdownOption[]>(() =>
    this.schools().map((school) => ({
      value: school.id,
      label: school.name,
      sub: school.city_region,
      initials: school.name
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase(),
    })),
  );

  protected readonly schoolCategoryOptions: DropdownOption[] = [
    { value: 'Primary', label: 'Primary' },
    { value: 'Secondary', label: 'Secondary' },
  ];

  protected readonly schoolTypeOptions: DropdownOption[] = [
    { value: 'Public', label: 'Public' },
    { value: 'Private', label: 'Private' },
  ];

  // Step 2: Credentials
  protected password = '';
  protected confirmPassword = '';
  protected readonly showPassword = signal(false);
  protected readonly showConfirm = signal(false);

  // Step 3: Security & Terms
  protected termsAccepted = false;
  protected privacyAccepted = false;

  // Add a School modal
  protected readonly schoolModalOpen = signal(false);
  protected schoolName = '';
  protected schoolCategory = '';
  protected schoolType = '';
  protected schoolCity = '';
  protected schoolContact = '';
  protected readonly schoolErrors = signal<FieldErrors>({});
  protected readonly schoolSaving = signal(false);

  // After sign-up
  protected readonly createdTeacher = signal<TeacherSelf | null>(null);
  protected readonly plans = signal<Plan[]>([]);
  protected readonly plansLoading = signal(false);
  protected readonly selectedPlanId = signal<number | null>(null);
  protected readonly chosenPlan = signal<Plan | null>(null);
  protected readonly chosenStatus = signal('');

  protected readonly username = computed(() => deriveUsername(this.email));
  protected readonly strength = computed(() => passwordStrength(this.password));
  protected readonly planPrice = planPrice;

  constructor() {
    this.portal.schools().subscribe({
      next: (response) => {
        this.schools.set(response.items);
        this.schoolsLoading.set(false);
      },
      error: () => this.schoolsLoading.set(false),
    });
  }

  protected stepIndex(step: Step): number {
    const index = STEP_ORDER.indexOf(step);
    return index === -1 ? STEP_ORDER.length : index;
  }

  protected goTo(step: Step): void {
    this.error.set('');
    this.errors.set({});
    this.step.set(step);
  }

  // ---------- Step 1 ----------

  protected submitProfile(): void {
    const errors: FieldErrors = {};
    if (!this.firstName.trim()) errors['first_name'] = 'First name is required.';
    if (!this.lastName.trim()) errors['last_name'] = 'Last name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) errors['email'] = 'Enter a valid email address.';
    if (!/^(\+63|0)?9\d{9}$/.test(this.mobile.replace(/[\s-]/g, ''))) {
      errors['mobile'] = 'Enter a valid mobile number, for example 09171234567.';
    }
    if (!this.schoolId) errors['school_id'] = 'Choose a school from the list.';
    this.errors.set(errors);
    if (Object.keys(errors).length === 0) {
      this.goTo('credentials');
    }
  }

  // ---------- Step 2 ----------

  protected submitCredentials(): void {
    const errors: FieldErrors = {};
    if (this.password.length < 8 || !/[A-Za-z]/.test(this.password) || !/[0-9]/.test(this.password)) {
      errors['password'] = 'Use at least 8 characters with a letter and a number.';
    }
    if (this.confirmPassword !== this.password) {
      errors['confirm'] = 'The two passwords do not match.';
    }
    this.errors.set(errors);
    if (Object.keys(errors).length === 0) {
      this.goTo('terms');
    }
  }

  // ---------- Step 3: create the account ----------

  protected submitTerms(): void {
    if (!this.termsAccepted || !this.privacyAccepted) {
      this.errors.set({ terms: 'Turn on both agreements to create your account.' });
      return;
    }
    this.error.set('');
    this.errors.set({});
    this.loading.set(true);

    this.auth
      .register({
        first_name: this.firstName,
        last_name: this.lastName,
        email: this.email,
        mobile: this.mobile,
        present_address: this.presentAddress,
        school_id: this.schoolId as number,
        password: this.password,
        terms_accepted: true,
      })
      .subscribe({
        next: (session) => {
          this.loading.set(false);
          this.createdTeacher.set({
            ...session.teacher,
            mobile: this.mobile,
            present_address: this.presentAddress,
            school_id: this.schoolId as number,
            school_name: this.schools().find((school) => school.id === this.schoolId)?.name ?? null,
            is_restricted: false,
            is_adviser: false,
            advisory_grade: null,
            advisory_section: null,
          });
          this.goTo('created');
        },
        error: (error) => {
          this.loading.set(false);
          this.errors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  // ---------- Add a School ----------

  protected openSchoolModal(): void {
    this.schoolErrors.set({});
    this.schoolModalOpen.set(true);
  }

  protected submitSchool(): void {
    const form: SchoolForm = {
      name: this.schoolName,
      category: this.schoolCategory,
      school_type: this.schoolType,
      city_region: this.schoolCity,
      principal_contact: this.schoolContact,
    };
    const errors: FieldErrors = {};
    if (!form.name.trim()) errors['name'] = 'School name is required.';
    if (!form.category) errors['category'] = 'Choose Primary or Secondary.';
    if (!form.school_type) errors['school_type'] = 'Choose Public or Private.';
    if (!form.city_region.trim()) errors['city_region'] = 'City or region is required.';
    this.schoolErrors.set(errors);
    if (Object.keys(errors).length > 0) return;

    this.schoolSaving.set(true);
    this.portal.addSchool(form).subscribe({
      next: (response) => {
        this.schoolSaving.set(false);
        this.schools.set([response.school, ...this.schools()]);
        this.schoolId = response.school.id;
        this.schoolModalOpen.set(false);
        this.schoolName = '';
        this.schoolCategory = '';
        this.schoolType = '';
        this.schoolCity = '';
        this.schoolContact = '';
      },
      error: (error) => {
        this.schoolSaving.set(false);
        this.schoolErrors.set(fieldErrors(error));
      },
    });
  }

  // ---------- Choose Plan ----------

  protected loadPlans(): void {
    this.goTo('plan');
    if (this.plans().length > 0) return;
    this.plansLoading.set(true);
    this.portal.activePlans().subscribe({
      next: (response) => {
        this.plans.set(response.items);
        this.plansLoading.set(false);
      },
      error: (error) => {
        this.plansLoading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected choosePlan(): void {
    const planId = this.selectedPlanId();
    if (!planId) return;
    this.error.set('');
    this.loading.set(true);
    this.portal.choosePlan(planId).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.chosenPlan.set(this.plans().find((plan) => plan.id === planId) ?? null);
        this.chosenStatus.set(response.subscription.status);
        this.goTo('started');
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected goToDashboard(): void {
    this.router.navigate(['/teacher/dashboard']);
  }
}
