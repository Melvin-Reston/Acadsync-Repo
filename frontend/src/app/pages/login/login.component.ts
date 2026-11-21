import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage, fieldErrors } from '../../core/helpers';
import { FieldErrors } from '../../core/models';
import { AuthShellComponent } from '../../shared/auth-shell.component';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, AuthShellComponent, IconComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected email = '';
  protected password = '';
  protected readonly showPassword = signal(false);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly errors = signal<FieldErrors>({});

  protected submit(): void {
    this.error.set('');
    this.errors.set({});
    this.loading.set(true);

    this.auth.login(this.email, this.password).subscribe({
      next: () => this.router.navigate(['/overview']),
      error: (error) => {
        this.loading.set(false);
        this.errors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
        this.password = '';
      },
    });
  }
}
