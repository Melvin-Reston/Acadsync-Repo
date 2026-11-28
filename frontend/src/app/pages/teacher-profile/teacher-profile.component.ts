import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  errorMessage,
  fieldErrors,
  peso,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from '../../core/helpers';
import { Teacher } from '../../core/models';
import { TeachersService } from '../../core/teachers.service';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { ModalComponent } from '../../shared/modal.component';
import { TeacherFormComponent } from '../../shared/teacher-form.component';
import { TemporaryPasswordComponent } from '../../shared/temporary-password.component';

type Dialog = 'none' | 'edit' | 'restrict' | 'unrestrict' | 'reset' | 'delete';

@Component({
  selector: 'app-teacher-profile',
  imports: [
    FormsModule,
    RouterLink,
    DatePipe,
    IconComponent,
    ModalComponent,
    TeacherFormComponent,
    TemporaryPasswordComponent,
  ],
  templateUrl: './teacher-profile.component.html',
})
export class TeacherProfileComponent implements OnInit {
  private readonly teachersApi = inject(TeachersService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  // From the address: /teachers/:id
  readonly id = input.required<string>();

  protected readonly teacher = signal<Teacher | null>(null);
  protected readonly error = signal('');
  protected readonly dialog = signal<Dialog>('none');
  protected readonly dialogError = signal('');
  protected readonly working = signal(false);
  protected readonly temporaryPassword = signal('');

  protected reason = '';

  protected readonly peso = peso;
  protected readonly statusLabel = subscriptionStatusLabel;
  protected readonly statusTone = subscriptionStatusTone;

  protected hasCurrentSubscription(teacher: Teacher): boolean {
    return ['trial', 'active', 'past_due'].includes(teacher.subscription_status ?? '');
  }

  ngOnInit(): void {
    this.teachersApi.get(Number(this.id())).subscribe({
      next: (response) => this.teacher.set(response.teacher),
      error: (error) => this.error.set(errorMessage(error)),
    });
  }

  protected open(dialog: Dialog): void {
    this.reason = '';
    this.dialogError.set('');
    this.dialog.set(dialog);
  }

  protected close(): void {
    this.dialog.set('none');
  }

  protected onEdited(teacher: Teacher): void {
    this.teacher.set(teacher);
    this.close();
    this.toast.success('Teacher details saved.');
  }

  protected restrict(): void {
    this.run(this.teachersApi.restrict(Number(this.id()), this.reason), 'Teacher restricted.');
  }

  protected unrestrict(): void {
    this.run(this.teachersApi.unrestrict(Number(this.id())), 'Restriction removed.');
  }

  protected deleteTeacher(): void {
    this.working.set(true);
    this.dialogError.set('');

    this.teachersApi.delete(Number(this.id())).subscribe({
      next: () => {
        this.working.set(false);
        this.close();
        this.toast.success('Teacher deleted.');
        void this.router.navigate(['/teachers']);
      },
      error: (error) => {
        this.working.set(false);
        this.dialogError.set(errorMessage(error));
      },
    });
  }

  protected resetPassword(): void {
    this.working.set(true);
    this.dialogError.set('');

    this.teachersApi.resetPassword(Number(this.id())).subscribe({
      next: (response) => {
        this.working.set(false);
        this.close();
        this.temporaryPassword.set(response.temporary_password);
        this.teacher.update((teacher) => (teacher ? { ...teacher, must_change_password: true } : teacher));
      },
      error: (error) => {
        this.working.set(false);
        this.dialogError.set(errorMessage(error));
      },
    });
  }

  // Shared steps for restrict / unrestrict.
  private run(request: ReturnType<TeachersService['restrict']>, successText: string): void {
    this.working.set(true);
    this.dialogError.set('');

    request.subscribe({
      next: (response) => {
        this.working.set(false);
        this.teacher.set(response.teacher);
        this.close();
        this.toast.success(successText);
      },
      error: (error) => {
        this.working.set(false);
        this.dialogError.set(fieldErrors(error)['reason'] ?? errorMessage(error));
      },
    });
  }
}
