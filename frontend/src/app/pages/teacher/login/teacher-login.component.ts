import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TeacherAuthService } from '../../../core/teacher-auth.service';
import { errorMessage, fieldErrors } from '../../../core/helpers';
import { FieldErrors } from '../../../core/models';
import { AuthShellComponent } from '../../../shared/auth-shell.component';
import { IconComponent } from '../../../shared/icon.component';

@Component({
  selector: 'app-teacher-login',
  imports: [FormsModule, RouterLink, AuthShellComponent, IconComponent],
  templateUrl: './teacher-login.component.html',
})
export class TeacherLoginComponent {
  private readonly auth = inject(TeacherAuthService);
  private readonly router = inject(Router);

  protected login = '';
  protected password = '';
  // Checked, as in the earlier design: the session then lasts 30 days instead of 8 hours.
  protected remember = true;
  protected readonly showPassword = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly errors = signal<FieldErrors>({});

  protected submit(): void {
    this.error.set('');
    this.errors.set({});
    this.loading.set(true);

    this.auth.login(this.login, this.password, this.remember).subscribe({
      next: () => this.router.navigate(['/teacher/dashboard']),
      error: (error) => {
        this.loading.set(false);
        this.errors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
        this.password = '';
      },
    });
  }
}
