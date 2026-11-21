// Shows a temporary password once, with a Copy button. It cannot be seen again after closing.
import { Component, input, output, signal } from '@angular/core';
import { IconComponent } from './icon.component';
import { ModalComponent } from './modal.component';

@Component({
  selector: 'app-temporary-password',
  imports: [ModalComponent, IconComponent],
  template: `
    <app-modal title="Temporary password" (closed)="closed.emit()">
      <p>
        Give this password to <strong>{{ ownerName() }}</strong
        >. It is shown only once.
      </p>
      <div class="secret">
        <code>{{ password() }}</code>
        <button type="button" class="btn btn-small" (click)="copy()">
          <app-icon [name]="copied() ? 'check' : 'copy'" [size]="15" />
          {{ copied() ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-primary" (click)="closed.emit()">Done</button>
      </div>
    </app-modal>
  `,
})
export class TemporaryPasswordComponent {
  readonly password = input.required<string>();
  readonly ownerName = input.required<string>();
  readonly closed = output<void>();

  protected readonly copied = signal(false);

  protected copy(): void {
    navigator.clipboard?.writeText(this.password()).then(
      () => this.copied.set(true),
      () => this.copied.set(false),
    );
  }
}
