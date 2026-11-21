import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage, fieldErrors } from '../../core/helpers';
import { FieldErrors } from '../../core/models';
import { AuthShellComponent } from '../../shared/auth-shell.component';
import { IconComponent } from '../../shared/icon.component';

@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink, AuthShellComponent, IconComponent],
  template: `
    <app-auth-shell heading="New password">
      @if (done()) {
        <div class="alert info" role="status">
          <app-icon name="check" [size]="16" />
          <span>{{ done() }}</span>
        </div>
        <a routerLink="/login" class="btn btn-primary btn-block">Sign in</a>
      } @else if (!token()) {
        <div class="alert" role="alert">
          <app-icon name="alert" [size]="16" />
          <span>This reset link is not valid. Request a new one.</span>
        </div>
        <a routerLink="/forgot-password" class="btn btn-primary btn-block">Request a new link</a>
      } @else {
        @if (error()) {
          <div class="alert" role="alert">
            <app-icon name="alert" [size]="16" />
            <span>{{ error() }}</span>
          </div>
        }

        <form (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="new-password">New password</label>
            <input
              id="new-password"
              name="newPassword"
              type="password"
              class="input"
              autocomplete="new-password"
              [class.invalid]="errors()['new_password']"
              [(ngModel)]="newPassword"
            />
            @if (errors()['new_password']) {
              <span class="field-error">{{ errors()['new_password'] }}</span>
            }
          </div>

          <div class="field">
            <label for="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              class="input"
              autocomplete="new-password"
              [class.invalid]="errors()['confirm']"
              [(ngModel)]="confirmPassword"
            />
            @if (errors()['confirm']) {
              <span class="field-error">{{ errors()['confirm'] }}</span>
            }
          </div>

          <button type="submit" class="btn btn-primary btn-block" [disabled]="loading()">
            {{ loading() ? 'Saving…' : 'Save new password' }}
          </button>
        </form>

        <div class="auth-links">
          <a routerLink="/login">Back to sign in</a>
        </div>
      }
    </app-auth-shell>
  `,
})
export class ResetPasswordComponent {
  private readonly auth = inject(AuthService);

  // Filled from the link: /reset-password?token=...
  readonly token = input('');

  protected newPassword = '';
  protected confirmPassword = '';
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly errors = signal<FieldErrors>({});
  protected readonly done = signal('');

  protected submit(): void {
    this.error.set('');
    this.errors.set({});

    if (this.newPassword !== this.confirmPassword) {
      this.errors.set({ confirm: 'The two passwords do not match.' });
      return;
    }

    this.loading.set(true);
    this.auth.resetPassword(this.token(), this.newPassword).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.done.set(response.message);
      },
      error: (error) => {
        this.loading.set(false);
        this.errors.set(fieldErrors(error));
        this.error.set(errorMessage(error));
      },
    });
  }
}
