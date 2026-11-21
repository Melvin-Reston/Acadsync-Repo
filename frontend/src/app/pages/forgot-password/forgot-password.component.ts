import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage, fieldErrors } from '../../core/helpers';
import { FieldErrors } from '../../core/models';
import { AuthShellComponent } from '../../shared/auth-shell.component';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink, AuthShellComponent, IconComponent],
  template: `
    <app-auth-shell heading="Forgot password">
      @if (sent()) {
        <div class="alert info" role="status">
          <app-icon name="check" [size]="16" />
          <span>{{ sent() }}</span>
        </div>
      } @else {
        @if (error()) {
          <div class="alert" role="alert">
            <app-icon name="alert" [size]="16" />
            <span>{{ error() }}</span>
          </div>
        }

        <form (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              class="input"
              autocomplete="username"
              [class.invalid]="errors()['email']"
              [(ngModel)]="email"
            />
            @if (errors()['email']) {
              <span class="field-error">{{ errors()['email'] }}</span>
            }
          </div>

          <button type="submit" class="btn btn-primary btn-block" [disabled]="loading()">
            {{ loading() ? 'Sending…' : 'Send reset link' }}
          </button>
        </form>
      }

      <div class="auth-links">
        <a routerLink="/login">Back to sign in</a>
      </div>
    </app-auth-shell>
  `,
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);

  protected email = '';
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly sent = signal('');

  protected submit(): void {
    this.error.set('');
    this.errors.set({});
    this.loading.set(true);

    this.auth.forgotPassword(this.email).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.sent.set(response.message);
      },
      error: (error) => {
        this.loading.set(false);
        this.errors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
      },
    });
  }
}
