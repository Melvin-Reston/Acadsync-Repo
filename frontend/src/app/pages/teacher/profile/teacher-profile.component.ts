// Teacher Profile: personal details, read-only teaching assignment, password change.
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TeacherAuthService } from '../../../core/teacher-auth.service';
import { TeacherPortalService } from '../../../core/teacher-portal.service';
import { errorMessage, fieldErrors } from '../../../core/helpers';
import { FieldErrors, TeacherSelf } from '../../../core/models';
import { ToastService } from '../../../core/toast.service';
import { IconComponent } from '../../../shared/icon.component';

@Component({
  selector: 'app-teacher-profile',
  imports: [FormsModule, IconComponent],
  templateUrl: './teacher-profile.component.html',
  styleUrl: './teacher-profile.component.css',
})
export class TeacherProfileComponent {
  private readonly auth = inject(TeacherAuthService);
  private readonly portal = inject(TeacherPortalService);
  private readonly toast = inject(ToastService);

  protected readonly teacher = signal<TeacherSelf | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly saving = signal(false);

  // Personal details
  protected firstName = '';
  protected lastName = '';
  protected email = '';
  protected mobile = '';
  protected presentAddress = '';

  // School details for the DepEd print forms (Region, Division, School ID).
  // The teacher's own entries; blank until filled in.
  protected region = '';
  protected division = '';
  protected depedSchoolId = '';

  // Password change
  protected currentPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';
  protected readonly passwordErrors = signal<FieldErrors>({});
  protected readonly changingPassword = signal(false);

  constructor() {
    this.portal.me().subscribe({
      next: (response) => {
        this.loading.set(false);
        this.teacher.set(response.teacher);
        this.firstName = response.teacher.first_name;
        this.lastName = response.teacher.last_name;
        this.email = response.teacher.email;
        this.mobile = response.teacher.mobile;
        this.presentAddress = response.teacher.present_address;
        this.region = response.teacher.region ?? '';
        this.division = response.teacher.division ?? '';
        this.depedSchoolId = response.teacher.deped_school_id ?? '';
      },
      error: (error) => {
        this.loading.set(false);
        this.error.set(errorMessage(error));
      },
    });
  }

  protected saveProfile(): void {
    this.error.set('');
    this.errors.set({});
    this.saving.set(true);

    this.portal
      .updateProfile({
        first_name: this.firstName,
        last_name: this.lastName,
        email: this.email,
        mobile: this.mobile,
        present_address: this.presentAddress,
        region: this.region,
        division: this.division,
        deped_school_id: this.depedSchoolId,
      })
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          this.teacher.set(response.teacher);
          // Keep the layout's teacher card in step with the edited name.
          this.auth.setTeacher(response.teacher);
          this.toast.success('Profile saved.');
        },
        error: (error) => {
          this.saving.set(false);
          this.errors.set(fieldErrors(error));
          this.error.set(errorMessage(error));
        },
      });
  }

  protected changePassword(): void {
    this.passwordErrors.set({});
    if (this.newPassword !== this.confirmPassword) {
      this.passwordErrors.set({ confirm: 'The two passwords do not match.' });
      return;
    }
    this.changingPassword.set(true);

    this.auth.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.toast.success('Password changed.');
      },
      error: (error) => {
        this.changingPassword.set(false);
        this.passwordErrors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
      },
    });
  }
}
